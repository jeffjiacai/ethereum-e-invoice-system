# Machine-checked verification

This directory contains an SMTChecker verification of the invoice lifecycle
invariants that the paper proves by hand (Section VII). Where the Hardhat test
suite checks specific scenarios, the SMTChecker's **CHC (constrained Horn
clause) engine** proves the invariants inductively over **all** reachable
transaction sequences and **all** invoice numbers.

## What is verified

[`EInvoiceModel.sol`](EInvoiceModel.sol) is a faithful abstraction of
`contracts/EInvoice.sol`: it keeps the enterprise registry, ownership, and the
exact guarded status transitions of the paper's transition-rule table
(`register / mint / issue / redFlush / declare / lock / reimburse / unlock`),
and abstracts away the invoice-face strings and hashing, which are irrelevant
to the state-machine safety properties. Ghost variables (`reimburseCount`,
`lastLocker`) are auxiliary state used only to state the properties.

The `assert` statements encode:

| Assertion | Paper result |
|---|---|
| `reimburseCount[n] == 1` after the reimburse body | **Theorem 1** — reimbursement uniqueness (an invoice is reimbursed at most once) |
| `msg.sender == lastLocker[n]` in `reimburse` | **Theorem 2** — reimbursement authorization |
| `!isCredit[n]` in `reimburse` | credit/reversed invoices can never be reimbursed |
| `total[m] == total[n]` in `redFlush` | **Theorem 4** — red-flush value conservation |
| `status[n] == Reversed && isCredit[m]` in `redFlush` | red-flush monotonicity (Lemma 1) |

## Result

```
Info: CHC: 5 verification condition(s) proved safe!
```

All five conditions are proved safe with no counterexamples, i.e. every
invariant holds for all transaction sequences. This upgrades the paper's
hand-written proofs to a machine-checked result against the abstracted
state machine.

## Running it

```bash
# one-time: fetch the solc 0.8.24 binary and an SMT solver
(cd .. && npx hardhat compile)      # downloads solc 0.8.24
pip install z3-solver==4.12.6.0     # provides libz3 (solc dlopens libz3.so.4.12)

bash verify.sh
```

The script locates the cached solc and the z3 library, exposes z3 under the
soname solc expects, and runs the CHC engine.

## Sanity check (the checker really would catch a bug)

To confirm the proof is not vacuous, temporarily change the reimburse guard in
`EInvoiceModel.sol` from `require(status[n] == Status.Locked)` to
`require(status[n] == Status.Locked || status[n] == Status.Reimbursed)` and
re-run: the CHC engine then reports an assertion violation on
`reimburseCount[n] == 1` with a counterexample trace (lock → reimburse →
reimburse). Revert the change to restore the proof.
