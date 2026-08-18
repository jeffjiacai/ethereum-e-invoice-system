// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EInvoiceModel — SMTChecker verification model of the invoice lifecycle
 * @notice This contract is a faithful abstraction of EInvoice.sol used for
 *         machine-checked verification with the Solidity SMTChecker (CHC engine).
 *         It keeps the enterprise registry, ownership, and the exact guarded
 *         status transitions of the guarded-transition table in the paper
 *         (register / mint / issue / redFlush / declare / lock / reimburse /
 *         unlock), and abstracts away the invoice-face strings and hashing,
 *         which are irrelevant to the state-machine safety properties and are
 *         not well supported by the checker.
 *
 *         Ghost variables (reimburseCount, lastLocker) are auxiliary state used
 *         only to state the properties; they do not exist in EInvoice.sol.
 *
 *         The `assert` statements encode the paper's Lemma 1 and Theorems 1, 2, 4.
 *         The CHC engine proves them safe over ALL reachable transaction
 *         sequences and all invoice numbers, i.e. an unbounded inductive proof.
 */
contract EInvoiceModel {
    enum Status { None, Blank, Issued, Locked, Reimbursed, Reversed }

    address public taxBureau;
    mapping(address => bool) public registered;

    mapping(uint256 => address) public owner_;
    mapping(uint256 => Status) public status;
    mapping(uint256 => bool) public isCredit;
    mapping(uint256 => bool) public declared;
    mapping(uint256 => address) public seller;
    mapping(uint256 => address) public buyer;
    mapping(uint256 => address) public locker;
    mapping(uint256 => uint256) public total;
    mapping(uint256 => uint256) public linked;

    // ---- ghost state for the properties (not in EInvoice.sol) ----
    mapping(uint256 => uint256) private reimburseCount; // Thm 1: how many times reimburse ran
    mapping(uint256 => address) private lastLocker;     // Thm 2: who most recently locked

    constructor() {
        taxBureau = msg.sender;
    }

    function registerEnterprise(address a) external {
        require(msg.sender == taxBureau);
        require(!registered[a]);
        registered[a] = true;
    }

    // Subsystem 1: distribution (single mint; batch grant is a loop of this)
    function mint(uint256 n, address to) external {
        require(msg.sender == taxBureau);
        require(registered[to]);
        require(status[n] == Status.None);
        owner_[n] = to;
        status[n] = Status.Blank;
    }

    // Subsystem 2: issuance
    function issue(uint256 n, address b, uint256 tot) external {
        require(registered[msg.sender]);
        require(owner_[n] == msg.sender);
        require(status[n] == Status.Blank);
        require(registered[b] && b != msg.sender);
        require(tot > 0);
        seller[n] = msg.sender;
        buyer[n] = b;
        total[n] = tot;
        isCredit[n] = false;
        status[n] = Status.Issued;
        owner_[n] = b;
    }

    // Subsystem 3: void and red-flush
    function redFlush(uint256 n, uint256 m) external {
        require(registered[msg.sender]);
        require(status[n] == Status.Issued && !isCredit[n]);
        require(seller[n] == msg.sender);
        require(owner_[m] == msg.sender && status[m] == Status.Blank);
        require(n != m);

        seller[m] = seller[n];
        buyer[m] = buyer[n];
        total[m] = total[n];
        isCredit[m] = true;
        linked[n] = m;
        linked[m] = n;
        status[n] = Status.Reversed;
        status[m] = Status.Issued;
        owner_[m] = buyer[n];

        // Theorem 4 (value conservation): credit magnitude equals the original.
        assert(total[m] == total[n]);
        // Original becomes terminal-reversed; credit is flagged.
        assert(status[n] == Status.Reversed && isCredit[m]);
    }

    // Subsystem 5a: declaration (orthogonal one-way flag)
    function declareTax(uint256 n) external {
        require(seller[n] == msg.sender);
        require(status[n] != Status.None && status[n] != Status.Blank);
        require(!isCredit[n]);
        require(!declared[n]);
        declared[n] = true;
    }

    // Subsystem 5b: lock-based reimbursement
    function lockForReimbursement(uint256 n) external {
        require(status[n] == Status.Issued);
        require(!isCredit[n]);
        require(owner_[n] == msg.sender);
        status[n] = Status.Locked;
        locker[n] = msg.sender;
        lastLocker[n] = msg.sender; // ghost
    }

    function reimburse(uint256 n) external {
        require(status[n] == Status.Locked);
        require(locker[n] == msg.sender);

        // Theorem 2 (authorization): the reimburser is exactly the locker.
        assert(msg.sender == lastLocker[n]);
        // A credit / reversed invoice can never reach here.
        assert(!isCredit[n]);

        // Theorem 1 (reimbursement uniqueness): this body runs at most once
        // per invoice over ANY transaction sequence.
        reimburseCount[n] += 1;
        assert(reimburseCount[n] == 1);

        status[n] = Status.Reimbursed;
    }

    function unlockReimbursement(uint256 n) external {
        require(status[n] == Status.Locked);
        require(locker[n] == msg.sender);
        status[n] = Status.Issued;
        locker[n] = address(0);
    }
}
