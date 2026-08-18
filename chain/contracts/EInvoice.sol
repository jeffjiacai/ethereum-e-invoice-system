// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EInvoice — Blockchain Electronic Invoice System
 * @notice Implements the five subsystems of the blockchain e-invoice design:
 *   1. Application & distribution: enterprises apply for blank invoices; the
 *      tax bureau mints numbered blank invoices to them.
 *   2. Issuing & circulation: a seller fills in the invoice face data and the
 *      invoice ownership transfers to the buyer.
 *   3. Void & red-flush: an erroneous invoice cannot be edited on-chain; the
 *      original seller issues a linked negative (credit) invoice instead.
 *   4. Query & verification: invoices are queryable by number and verifiable
 *      by a keccak256 digest of the invoice face.
 *   5. Declaration & reimbursement: the seller declares output tax; the buyer
 *      reimburses through a lock -> reimburse protocol that makes duplicate
 *      reimbursement impossible.
 *
 * Invoices are modeled as non-fungible tokens (ERC-721 inspired) whose
 * transfers are restricted to lifecycle functions: they cannot be traded.
 */
contract EInvoice {
    string public constant name = "Blockchain Electronic Invoice";
    string public constant symbol = "EINV";

    // ------------------------------------------------------------------
    // Roles and enterprise registry
    // ------------------------------------------------------------------

    address public taxBureau;

    struct Enterprise {
        string taxpayerId; // unified taxpayer identification number
        string legalName;
        string bankInfo; // opening bank and account number
        string registeredAddress;
        bool registered;
        uint64 registeredAt;
    }

    mapping(address => Enterprise) public enterprises;

    /// Policy switch: if true, an invoice must be tax-declared by the seller
    /// before the buyer may lock it for reimbursement.
    bool public requireDeclaredBeforeReimburse;

    modifier onlyTaxBureau() {
        require(msg.sender == taxBureau, "EInvoice: caller is not tax bureau");
        _;
    }

    modifier onlyRegistered() {
        require(enterprises[msg.sender].registered, "EInvoice: caller not a registered enterprise");
        _;
    }

    // ------------------------------------------------------------------
    // Invoice data model
    // ------------------------------------------------------------------

    enum Status {
        None, // does not exist
        Blank, // minted to an enterprise, not yet issued
        Issued, // face data filled, owned by buyer
        Locked, // locked by the buyer pending reimbursement
        Reimbursed, // reimbursement completed (terminal)
        Reversed // offset by a linked red-flush credit invoice (terminal)
    }

    struct Party {
        address account;
        string taxpayerId;
        string legalName;
        string bankInfo;
        string registeredAddress;
    }

    struct Invoice {
        uint256 invoiceId;
        Party seller;
        Party buyer;
        uint256 preTaxAmount; // integer cents
        uint256 taxRateBps; // tax rate in basis points (1300 = 13%)
        uint256 taxAmount; // integer cents, = preTaxAmount * taxRateBps / 10000
        uint256 totalAmount; // integer cents, = preTaxAmount + taxAmount
        uint256 taxCategoryCode; // goods & services tax classification code
        string itemDescription;
        Status status;
        bool isCredit; // true for a red-flush (negative) invoice
        bool declared; // output tax declared by the seller
        uint256 linkedInvoiceId; // original <-> credit invoice linkage
        uint64 issuedAt;
        bytes32 contentHash; // keccak256 digest of the invoice face
    }

    mapping(uint256 => Invoice) internal invoices;

    // ERC-721-style ownership bookkeeping
    mapping(uint256 => address) internal invoiceOwner;
    mapping(address => uint256[]) internal ownedInvoices;
    mapping(uint256 => uint256) internal ownedInvoicesIndex;
    mapping(address => uint256) public ownedInvoicesCount;
    uint256[] internal allInvoices;

    // digest -> invoice number, for hash-based authenticity verification
    mapping(bytes32 => uint256) internal hashToInvoiceId;

    // ------------------------------------------------------------------
    // Application & distribution
    // ------------------------------------------------------------------

    struct Application {
        address applicant;
        uint32 count;
        bool processed;
        bool approved;
        uint64 appliedAt;
    }

    Application[] public applications;

    // ------------------------------------------------------------------
    // Reimbursement lock
    // ------------------------------------------------------------------

    struct ReimbursementLock {
        address locker;
        string claimDocId; // identifier of the expense claim document
        uint64 lockedAt;
    }

    mapping(uint256 => ReimbursementLock) internal locks;

    // ------------------------------------------------------------------
    // Events (full audit trail)
    // ------------------------------------------------------------------

    event EnterpriseRegistered(address indexed account, string taxpayerId, string legalName);
    event InvoicesApplied(uint256 indexed applicationId, address indexed applicant, uint32 count);
    event ApplicationProcessed(uint256 indexed applicationId, bool approved);
    event InvoicesGranted(address indexed to, uint256 startId, uint32 count);
    event Transfer(address indexed from, address indexed to, uint256 indexed invoiceId);
    event InvoiceIssued(
        uint256 indexed invoiceId,
        address indexed seller,
        address indexed buyer,
        uint256 totalAmount,
        bytes32 contentHash
    );
    event InvoiceRedFlushed(uint256 indexed originalId, uint256 indexed creditId, address indexed seller);
    event TaxDeclared(uint256 indexed invoiceId, address indexed seller, uint256 taxAmount);
    event InvoiceLocked(uint256 indexed invoiceId, address indexed locker, string claimDocId);
    event InvoiceUnlocked(uint256 indexed invoiceId, address indexed locker);
    event InvoiceReimbursed(uint256 indexed invoiceId, address indexed locker, uint256 totalAmount);

    constructor() {
        taxBureau = msg.sender;
    }

    // ------------------------------------------------------------------
    // Registry administration
    // ------------------------------------------------------------------

    function registerEnterprise(
        address account,
        string calldata taxpayerId,
        string calldata legalName,
        string calldata bankInfo,
        string calldata registeredAddress
    ) external onlyTaxBureau {
        require(account != address(0), "EInvoice: zero address");
        require(!enterprises[account].registered, "EInvoice: already registered");
        enterprises[account] = Enterprise({
            taxpayerId: taxpayerId,
            legalName: legalName,
            bankInfo: bankInfo,
            registeredAddress: registeredAddress,
            registered: true,
            registeredAt: uint64(block.timestamp)
        });
        emit EnterpriseRegistered(account, taxpayerId, legalName);
    }

    function setRequireDeclaredBeforeReimburse(bool value) external onlyTaxBureau {
        requireDeclaredBeforeReimburse = value;
    }

    // ------------------------------------------------------------------
    // Subsystem 1: application & distribution
    // ------------------------------------------------------------------

    /// An enterprise applies for `count` blank invoices.
    function applyForInvoices(uint32 count) external onlyRegistered returns (uint256 applicationId) {
        require(count > 0, "EInvoice: count is zero");
        applications.push(
            Application({
                applicant: msg.sender,
                count: count,
                processed: false,
                approved: false,
                appliedAt: uint64(block.timestamp)
            })
        );
        applicationId = applications.length - 1;
        emit InvoicesApplied(applicationId, msg.sender, count);
    }

    /// The tax bureau approves an application and mints the numbered range
    /// [startId, startId + granted) of blank invoices to the applicant. The
    /// bureau may grant fewer invoices than applied for.
    function approveApplication(uint256 applicationId, uint256 startId, uint32 granted) external onlyTaxBureau {
        Application storage app = applications[applicationId];
        require(!app.processed, "EInvoice: application already processed");
        require(granted > 0 && granted <= app.count, "EInvoice: invalid grant count");
        app.processed = true;
        app.approved = true;
        _grant(app.applicant, startId, granted);
        emit ApplicationProcessed(applicationId, true);
    }

    function rejectApplication(uint256 applicationId) external onlyTaxBureau {
        Application storage app = applications[applicationId];
        require(!app.processed, "EInvoice: application already processed");
        app.processed = true;
        emit ApplicationProcessed(applicationId, false);
    }

    /// Direct grant without an application (e.g. initial quota).
    function grantInvoices(address to, uint256 startId, uint32 count) external onlyTaxBureau {
        require(count > 0, "EInvoice: count is zero");
        _grant(to, startId, count);
    }

    function _grant(address to, uint256 startId, uint32 count) internal {
        require(enterprises[to].registered, "EInvoice: grantee not registered");
        for (uint256 i = 0; i < count; i++) {
            _mint(to, startId + i);
        }
        emit InvoicesGranted(to, startId, count);
    }

    function _mint(address to, uint256 invoiceId) internal {
        require(invoiceId != 0, "EInvoice: invoice id is zero");
        require(invoiceOwner[invoiceId] == address(0), "EInvoice: invoice number already exists");
        _addInvoiceTo(to, invoiceId);
        Invoice storage inv = invoices[invoiceId];
        inv.invoiceId = invoiceId;
        inv.status = Status.Blank;
        allInvoices.push(invoiceId);
        emit Transfer(address(0), to, invoiceId);
    }

    // ------------------------------------------------------------------
    // Restricted ownership transfer (internal only — invoices are not tradable)
    // ------------------------------------------------------------------

    function _transfer(address from, address to, uint256 invoiceId) internal {
        require(invoiceOwner[invoiceId] == from, "EInvoice: not invoice owner");
        require(to != address(0), "EInvoice: zero address");
        _removeInvoiceFrom(from, invoiceId);
        _addInvoiceTo(to, invoiceId);
        emit Transfer(from, to, invoiceId);
    }

    function _addInvoiceTo(address to, uint256 invoiceId) internal {
        invoiceOwner[invoiceId] = to;
        ownedInvoicesIndex[invoiceId] = ownedInvoices[to].length;
        ownedInvoices[to].push(invoiceId);
        ownedInvoicesCount[to] += 1;
    }

    function _removeInvoiceFrom(address from, uint256 invoiceId) internal {
        uint256 index = ownedInvoicesIndex[invoiceId];
        uint256 lastIndex = ownedInvoices[from].length - 1;
        if (index != lastIndex) {
            uint256 lastId = ownedInvoices[from][lastIndex];
            ownedInvoices[from][index] = lastId;
            ownedInvoicesIndex[lastId] = index;
        }
        ownedInvoices[from].pop();
        ownedInvoicesCount[from] -= 1;
        invoiceOwner[invoiceId] = address(0);
    }

    // ------------------------------------------------------------------
    // Subsystem 2: issuing & circulation
    // ------------------------------------------------------------------

    /// The seller fills in the invoice face and the invoice transfers to the
    /// buyer. Party details are snapshotted from the enterprise registry so
    /// the invoice face is immutable even if registry data later changes.
    function issueInvoice(
        uint256 invoiceId,
        address buyer,
        uint256 preTaxAmount,
        uint256 taxRateBps,
        uint256 taxCategoryCode,
        string calldata itemDescription
    ) external onlyRegistered {
        require(invoiceOwner[invoiceId] == msg.sender, "EInvoice: caller does not hold this blank invoice");
        Invoice storage inv = invoices[invoiceId];
        require(inv.status == Status.Blank, "EInvoice: invoice already issued");
        require(enterprises[buyer].registered, "EInvoice: buyer not a registered enterprise");
        require(buyer != msg.sender, "EInvoice: buyer equals seller");
        require(preTaxAmount > 0, "EInvoice: amount is zero");
        require(taxRateBps <= 10000, "EInvoice: invalid tax rate");

        _fillFace(inv, msg.sender, buyer, preTaxAmount, taxRateBps, taxCategoryCode, itemDescription, false);
        _transfer(msg.sender, buyer, invoiceId);
        emit InvoiceIssued(invoiceId, msg.sender, buyer, inv.totalAmount, inv.contentHash);
    }

    // ------------------------------------------------------------------
    // Subsystem 3: void & red-flush
    // ------------------------------------------------------------------

    /// Because on-chain data is immutable, an erroneous invoice is voided by
    /// issuing a linked credit invoice with identical face data and negative
    /// amounts (represented by `isCredit`), using a blank invoice held by the
    /// original seller. The original invoice becomes Reversed.
    function redFlush(uint256 originalId, uint256 blankId) external onlyRegistered {
        Invoice storage original = invoices[originalId];
        require(original.status == Status.Issued, "EInvoice: original not in issued state");
        require(!original.isCredit, "EInvoice: cannot red-flush a credit invoice");
        require(original.seller.account == msg.sender, "EInvoice: caller is not the original seller");
        require(invoiceOwner[blankId] == msg.sender, "EInvoice: caller does not hold this blank invoice");
        Invoice storage credit = invoices[blankId];
        require(credit.status == Status.Blank, "EInvoice: credit invoice must be blank");

        _fillFace(
            credit,
            msg.sender,
            original.buyer.account,
            original.preTaxAmount,
            original.taxRateBps,
            original.taxCategoryCode,
            original.itemDescription,
            true
        );
        credit.linkedInvoiceId = originalId;
        original.linkedInvoiceId = blankId;
        original.status = Status.Reversed;
        _transfer(msg.sender, original.buyer.account, blankId);
        emit InvoiceRedFlushed(originalId, blankId, msg.sender);
    }

    function _fillFace(
        Invoice storage inv,
        address seller,
        address buyer,
        uint256 preTaxAmount,
        uint256 taxRateBps,
        uint256 taxCategoryCode,
        string memory itemDescription,
        bool isCredit
    ) internal {
        Enterprise storage s = enterprises[seller];
        Enterprise storage b = enterprises[buyer];
        inv.seller = Party(seller, s.taxpayerId, s.legalName, s.bankInfo, s.registeredAddress);
        inv.buyer = Party(buyer, b.taxpayerId, b.legalName, b.bankInfo, b.registeredAddress);
        inv.preTaxAmount = preTaxAmount;
        inv.taxRateBps = taxRateBps;
        inv.taxAmount = (preTaxAmount * taxRateBps) / 10000;
        inv.totalAmount = preTaxAmount + inv.taxAmount;
        inv.taxCategoryCode = taxCategoryCode;
        inv.itemDescription = itemDescription;
        inv.status = Status.Issued;
        inv.isCredit = isCredit;
        inv.issuedAt = uint64(block.timestamp);
        inv.contentHash = keccak256(
            abi.encode(
                inv.invoiceId,
                s.taxpayerId,
                b.taxpayerId,
                preTaxAmount,
                taxRateBps,
                taxCategoryCode,
                itemDescription,
                isCredit,
                inv.issuedAt
            )
        );
        hashToInvoiceId[inv.contentHash] = inv.invoiceId;
    }

    // ------------------------------------------------------------------
    // Subsystem 4: query & verification
    // ------------------------------------------------------------------

    function exists(uint256 invoiceId) public view returns (bool) {
        return invoiceOwner[invoiceId] != address(0);
    }

    function ownerOf(uint256 invoiceId) public view returns (address) {
        address owner = invoiceOwner[invoiceId];
        require(owner != address(0), "EInvoice: invoice does not exist");
        return owner;
    }

    function getInvoice(uint256 invoiceId) external view returns (Invoice memory) {
        require(exists(invoiceId), "EInvoice: invoice does not exist");
        return invoices[invoiceId];
    }

    /// Digest-based authenticity check: anyone holding an invoice face can
    /// recompute its keccak256 digest and confirm the chain stores it.
    function verifyByHash(bytes32 contentHash) external view returns (bool valid, uint256 invoiceId) {
        invoiceId = hashToInvoiceId[contentHash];
        valid = invoiceId != 0;
    }

    function invoicesOf(address holder) external view returns (uint256[] memory) {
        return ownedInvoices[holder];
    }

    function totalSupply() external view returns (uint256) {
        return allInvoices.length;
    }

    function invoiceByIndex(uint256 index) external view returns (uint256) {
        return allInvoices[index];
    }

    function applicationCount() external view returns (uint256) {
        return applications.length;
    }

    function getLock(uint256 invoiceId) external view returns (ReimbursementLock memory) {
        return locks[invoiceId];
    }

    // ------------------------------------------------------------------
    // Subsystem 5: declaration & reimbursement
    // ------------------------------------------------------------------

    /// The seller declares the output tax of an issued invoice.
    function declareTax(uint256 invoiceId) external returns (uint256 taxAmount) {
        Invoice storage inv = invoices[invoiceId];
        require(inv.status != Status.None && inv.status != Status.Blank, "EInvoice: invoice not issued");
        require(inv.seller.account == msg.sender, "EInvoice: caller is not the seller");
        require(!inv.isCredit, "EInvoice: credit invoices are not declared");
        require(!inv.declared, "EInvoice: already declared");
        inv.declared = true;
        taxAmount = inv.taxAmount;
        emit TaxDeclared(invoiceId, msg.sender, taxAmount);
    }

    /// Step 1 of reimbursement: the invoice holder locks the invoice against
    /// an expense claim document. A locked invoice cannot be locked again,
    /// which makes duplicate reimbursement impossible by construction.
    function lockForReimbursement(uint256 invoiceId, string calldata claimDocId) external {
        Invoice storage inv = invoices[invoiceId];
        require(inv.status == Status.Issued, "EInvoice: invoice not available for reimbursement");
        require(!inv.isCredit, "EInvoice: credit invoices cannot be reimbursed");
        require(invoiceOwner[invoiceId] == msg.sender, "EInvoice: caller does not hold this invoice");
        if (requireDeclaredBeforeReimburse) {
            require(inv.declared, "EInvoice: invoice not yet tax-declared");
        }
        inv.status = Status.Locked;
        locks[invoiceId] = ReimbursementLock({
            locker: msg.sender,
            claimDocId: claimDocId,
            lockedAt: uint64(block.timestamp)
        });
        emit InvoiceLocked(invoiceId, msg.sender, claimDocId);
    }

    /// Step 2: complete the reimbursement. Terminal state.
    function reimburse(uint256 invoiceId) external {
        Invoice storage inv = invoices[invoiceId];
        require(inv.status == Status.Locked, "EInvoice: invoice not locked");
        require(locks[invoiceId].locker == msg.sender, "EInvoice: caller did not lock this invoice");
        inv.status = Status.Reimbursed;
        emit InvoiceReimbursed(invoiceId, msg.sender, inv.totalAmount);
    }

    /// If reimbursement fails off-chain (over budget, past deadline, ...),
    /// only the locker may release the invoice back to the Issued state.
    function unlockReimbursement(uint256 invoiceId) external {
        Invoice storage inv = invoices[invoiceId];
        require(inv.status == Status.Locked, "EInvoice: invoice not locked");
        require(locks[invoiceId].locker == msg.sender, "EInvoice: caller did not lock this invoice");
        delete locks[invoiceId];
        inv.status = Status.Issued;
        emit InvoiceUnlocked(invoiceId, msg.sender);
    }
}
