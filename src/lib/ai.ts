import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ungroundedNumbers } from "./rules";

// De-identified input: no name, HN, CID, phone. Only what a summary needs.
export type LabHistory = {
  sex: "M" | "F";
  age: number;
  results: { date: string; test: string; name: string; loinc: string | null; value: string; unit: string | null; ref: string; flag: string | null }[];
  pending: { test: string; name: string; status: string }[];
};

const Summary = z.object({
  headline: z.string().describe("หนึ่งประโยค สรุปภาพรวมที่แพทย์ควรรู้ก่อน"),
  findings: z.array(
    z.object({
      test: z.string(),
      severity: z.enum(["critical", "abnormal", "normal"]),
      note: z.string().describe("ค่าล่าสุด เทียบค่าอ้างอิง และแนวโน้มถ้ามีหลายครั้ง"),
    }),
  ),
  pending: z.array(z.string()).describe("test ที่ยังไม่มีผล"),
});
export type AiSummary = z.infer<typeof Summary> & { source: "ai" | "rules"; warning?: string };

const SYSTEM = `คุณช่วยสรุปผลตรวจทางห้องปฏิบัติการให้แพทย์อ่านอย่างรวดเร็ว เขียนภาษาไทย กระชับ ใช้ชื่อ test ภาษาอังกฤษตามเดิม
กฎ:
- ใช้เฉพาะตัวเลขที่อยู่ในข้อมูลที่ให้มาเท่านั้น ห้ามคำนวณหรือประมาณค่าใหม่
- บอกแนวโน้มเมื่อ test เดียวกันมีหลายครั้ง (สูงขึ้น/ลดลง/คงที่)
- เรียงค่าวิกฤตก่อน ตามด้วยค่าผิดปกติ แล้วค่าปกติ
- ห้ามวินิจฉัยโรค ห้ามแนะนำการรักษาหรือยา การตัดสินใจเป็นของแพทย์`;

export async function summarizeLabs(h: LabHistory): Promise<AiSummary> {
  try {
    // created per call: a missing key must fall back to rules, not crash the module at import
    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
    const res = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(Summary) },
      // if the primary model declines, the API retries on a fallback model in the same call
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(h) }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`AI did not return a summary (${res.stop_reason})`);

    // guardrail: every number the AI writes must exist in the input, otherwise warn the doctor
    const bad = ungroundedNumbers(JSON.stringify(res.parsed_output), JSON.stringify(h));
    return {
      ...res.parsed_output,
      source: "ai",
      warning: bad.length ? `พบตัวเลขที่ไม่มีในข้อมูลต้นฉบับ: ${bad.join(", ")} โปรดตรวจกับตารางผล` : undefined,
    };
  } catch (e) {
    // no key / network / refusal: the page still works, with a plain rule-based summary
    console.error("AI summary failed:", e instanceof Anthropic.APIError ? `${e.status ?? "network"} ${e.message}` : e);
    return { ...ruleSummary(h), source: "rules", warning: "AI ใช้งานไม่ได้ในขณะนี้ แสดงสรุปอัตโนมัติแบบกฎแทน" };
  }
}

// Deterministic fallback: latest value per test, abnormal first.
export function ruleSummary(h: LabHistory): z.infer<typeof Summary> {
  const latest = new Map<string, LabHistory["results"][number][]>();
  for (const r of h.results) latest.set(r.test, [...(latest.get(r.test) ?? []), r]);
  const rank = { critical: 0, abnormal: 1, normal: 2 } as const;
  const findings = [...latest.values()]
    .map((rs) => {
      const last = rs[rs.length - 1];
      const severity = last.flag === "LL" || last.flag === "HH" ? "critical" : last.flag && last.flag !== "N" ? "abnormal" : "normal";
      const prev = rs.length > 1 ? ` (ครั้งก่อน ${rs[rs.length - 2].value})` : "";
      return { test: last.test, severity, note: `${last.value} ${last.unit ?? ""} ค่าอ้างอิง ${last.ref}${prev}`.trim() } as const;
    })
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
  const abnormal = findings.filter((f) => f.severity !== "normal").length;
  return {
    headline: findings.length ? `ผลตรวจ ${findings.length} รายการ ผิดปกติ ${abnormal} รายการ` : "ยังไม่มีผลที่รายงานแล้ว",
    findings,
    pending: h.pending.map((p) => `${p.test} (${p.status})`),
  };
}
