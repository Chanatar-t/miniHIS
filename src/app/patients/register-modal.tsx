"use client";
import { X } from "lucide-react";

import { useEffect, useRef, useState } from "react";
import { PatientForm } from "./new/form";

const OPEN_EVENT = "open-register";

// A second trigger elsewhere on the page opens the same (single) modal, so field ids stay unique
export function OpenRegisterButton({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))} className={className}>
      {children}
    </button>
  );
}

// Registration in a floating dialog. Rule: never lose typed data by accident.
// Clean form  -> backdrop click / Esc / close button close it.
// Dirty form  -> backdrop click does nothing but warn; Esc / close / ยกเลิก ask "discard?" first.
// "Dirty" = differs from the fresh form (pre-filled search text is not dirty). Closed while dirty -> "draft" badge.
export function RegisterModal({ initial, children, className }: { initial: Record<string, string>; children: React.ReactNode; className: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const snapshot = useRef("");
  const [warn, setWarn] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [shake, setShake] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const serialize = () => {
    const form = dialog.current?.querySelector("form");
    return form ? new URLSearchParams([...new FormData(form)].map(([k, v]) => [k, String(v)])).toString() : "";
  };
  const dirty = () => serialize() !== snapshot.current;

  // Baseline is taken from a FRESH form only (first open, after discard, new pre-fill) — not on every open.
  // Browsers force-close a dialog on a second quick Esc; leftover data must still count as dirty when reopened.
  const fresh = useRef(true);
  const discarding = useRef(false);
  const [draft, setDraft] = useState(false);
  const initKey = JSON.stringify(initial);
  useEffect(() => {
    fresh.current = true;
  }, [initKey]);

  const open = () => {
    setWarn(false);
    setConfirming(false);
    dialog.current?.showModal();
    if (fresh.current) {
      snapshot.current = serialize();
      fresh.current = false;
    }
  };
  const close = () => dialog.current?.close();
  const tryClose = () => (dirty() ? setConfirming(true) : close());
  const discard = () => {
    discarding.current = true;
    fresh.current = true;
    setFormKey((k) => k + 1); // fresh, empty form next time
    close();
  };
  useEffect(() => {
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  });
  const nudge = () => {
    setWarn(true);
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  return (
    <>
      <button type="button" onClick={open} className={className}>
        {children}
        {draft && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">มีร่างค้าง</span>}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="reg-title"
        // own view-transition layer: never painted over by the page, fades out if a save navigates away
        style={{ viewTransitionName: "register-modal" }}
        className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl bg-transparent p-0 backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm"
        // the dialog element itself only receives clicks on the backdrop (content fills it)
        onClick={(e) => {
          if (e.target !== dialog.current) return;
          if (dirty()) nudge();
          else close();
        }}
        onCancel={(e) => {
          // Esc
          e.preventDefault();
          tryClose();
        }}
        onInput={() => setWarn(false)}
        // fires on every close, including the browser's forced close
        onClose={() => {
          setDraft(!discarding.current && dirty());
          discarding.current = false;
        }}
      >
        <div className={`rounded-2xl bg-white shadow-2xl ${shake ? "animate-shake" : ""}`}>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 id="reg-title" className="text-lg font-semibold">
                ลงทะเบียนผู้ป่วยใหม่
              </h2>
              <p className="text-xs text-slate-500">บันทึกแล้วได้ HN ทันที และเปิด Visit ต่อได้เลย</p>
            </div>
            <button type="button" onClick={tryClose} aria-label="ปิด" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          {warn && !confirming && (
            <p role="status" className="animate-fade-up mx-5 mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              มีข้อมูลที่กรอกไว้ หน้าต่างจึงไม่ปิดเอง ถ้าต้องการปิดให้กด ยกเลิก
            </p>
          )}
          {confirming && (
            <div role="alertdialog" aria-label="ยืนยันการทิ้งข้อมูล" className="animate-fade-up mx-5 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              <span className="flex-1">ทิ้งข้อมูลที่กรอกไว้?</span>
              <button type="button" onClick={() => setConfirming(false)} autoFocus className="btn-ghost">
                กลับไปกรอกต่อ
              </button>
              <button type="button" onClick={discard} className="btn bg-red-600 hover:bg-red-700">
                ทิ้งข้อมูล
              </button>
            </div>
          )}

          <div className="p-5">
            {/* re-key when the pre-fill changes (new search text) so defaultValues apply */}
            <PatientForm key={`${formKey}-${JSON.stringify(initial)}`} initial={initial} bare onCancel={tryClose} />
          </div>
        </div>
      </dialog>
    </>
  );
}
