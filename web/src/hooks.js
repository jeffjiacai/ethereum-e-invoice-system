import { useCallback, useEffect, useState } from "react";
import { readContract, revertReason } from "./eth.js";

/** Loads all invoices (id ascending), refreshed on `version` bumps. */
export function useAllInvoices(version) {
  const [invoices, setInvoices] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const total = Number(await readContract.totalSupply());
        const ids = await Promise.all(
          Array.from({ length: total }, (_, i) => readContract.invoiceByIndex(i))
        );
        const invs = await Promise.all(ids.map((id) => readContract.getInvoice(id)));
        if (!cancelled) {
          setInvoices([...invs].sort((a, b) => Number(a.invoiceId) - Number(b.invoiceId)));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  return { invoices, error };
}

/** Wraps a contract call: runs it, reports success/revert, bumps refresh. */
export function useTx(onDone) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {kind: 'ok'|'err', text}

  const run = useCallback(
    async (fn, successText) => {
      setBusy(true);
      setMsg(null);
      try {
        const tx = await fn();
        await tx.wait();
        setMsg({ kind: "ok", text: successText });
        onDone?.();
      } catch (e) {
        setMsg({ kind: "err", text: `Rejected by contract: ${revertReason(e)}` });
      } finally {
        setBusy(false);
      }
    },
    [onDone]
  );

  return { busy, msg, run, clearMsg: () => setMsg(null) };
}
