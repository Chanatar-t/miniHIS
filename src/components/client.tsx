"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export function Barcode({ value, height = 40 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, value, { format: "CODE128", height, width: 1.6, fontSize: 12, margin: 0 });
  }, [value, height]);
  return <svg ref={ref} />;
}

export function PrintButton({ label = "พิมพ์" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn no-print">
      🖨 {label}
    </button>
  );
}
