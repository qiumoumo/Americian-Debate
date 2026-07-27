"use server";

import { revalidatePath } from "next/cache";
import type { ArgumentOutcome, DebateFormat, MatchResult, Side } from "@debate/shared";
import {
  saveMatchReport,
  type MatchReportPayload,
  type SaveMatchReportCommand
} from "@/lib/match-reports";
import { requireUser } from "@/lib/auth";

export type MatchReportActionCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "REVISION_CONFLICT";

export interface MatchReportActionState {
  ok: boolean;
  message: string;
  code?: MatchReportActionCode;
  fieldErrors?: Record<string, string>;
  matchId?: string;
  reportRevision?: number;
}

type JsonRecord = Record<string, unknown>;

function stringValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function nullableString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readJsonArray(formData: FormData, name: string): { value: JsonRecord[]; error?: string } {
  const raw = stringValue(formData, name);
  if (!raw) return { value: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))) {
      return { value: [], error: "Report snapshot must be a list of records" };
    }
    return { value: value as JsonRecord[] };
  } catch {
    return { value: [], error: "Report snapshot JSON is invalid" };
  }
}

function actionCode(error: unknown): MatchReportActionCode | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = String(error.code);
  if (code === "NOT_FOUND" || code === "FORBIDDEN" || code === "VALIDATION_FAILED" || code === "REVISION_CONFLICT") {
    return code;
  }
  return undefined;
}

function actionMessage(code: MatchReportActionCode | undefined) {
  if (code === "NOT_FOUND") return "未找到这场比赛，记录可能已被删除。";
  if (code === "FORBIDDEN") return "你没有权限修改这份赛后报告。";
  if (code === "VALIDATION_FAILED") return "部分比赛数据不完整或格式不正确，请检查后重试。";
  if (code === "REVISION_CONFLICT") return "报告已被其他成员修改。当前输入仍保留，请重新加载服务器版本后再合并。";
  return "保存失败，请稍后重试。";
}

function issuesFrom(error: unknown) {
  if (!error || typeof error !== "object" || !("issues" in error)) return undefined;
  const issues = error.issues;
  if (!issues || typeof issues !== "object" || Array.isArray(issues)) return undefined;
  return Object.fromEntries(Object.entries(issues).map(([key, value]) => [key, String(value)]));
}

export async function saveMatchReportAction(
  _previousState: MatchReportActionState,
  formData: FormData
): Promise<MatchReportActionState> {
  const session = await requireUser();
  const argumentSnapshot = readJsonArray(formData, "argumentOutcomesJson");
  const evidenceSnapshot = readJsonArray(formData, "evidenceJson");
  const snapshotIssues: Record<string, string> = {};
  if (argumentSnapshot.error) snapshotIssues.argumentOutcomes = argumentSnapshot.error;
  if (evidenceSnapshot.error) snapshotIssues.evidence = evidenceSnapshot.error;
  if (Object.keys(snapshotIssues).length) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: actionMessage("VALIDATION_FAILED"),
      fieldErrors: snapshotIssues
    };
  }

  const argumentOutcomes = argumentSnapshot.value.map((item) => ({
    argument: String(item.argument ?? "").trim(),
    side: String(item.side ?? "Generic") as Side,
    category: String(item.category ?? "general").trim() || "general",
    outcome: String(item.outcome ?? "") as ArgumentOutcome,
    confidence: Number(item.confidence ?? 3),
    notes: String(item.notes ?? "").trim()
  }));
  const evidence = evidenceSnapshot.value.map((item) => ({
    evidenceId: String(item.evidenceId ?? "").trim(),
    speechType: nullableString(item.speechType),
    effectivenessRating: item.effectivenessRating === null || item.effectivenessRating === ""
      ? null
      : Number(item.effectivenessRating),
    notes: String(item.notes ?? "").trim()
  }));

  const report: MatchReportPayload = {
    tournament: stringValue(formData, "tournament"),
    roundNumber: stringValue(formData, "roundNumber"),
    opponent: stringValue(formData, "opponent"),
    topic: stringValue(formData, "topic"),
    format: stringValue(formData, "format") as DebateFormat,
    side: stringValue(formData, "side") as Side,
    result: stringValue(formData, "result") as MatchResult,
    judge: stringValue(formData, "judge"),
    date: stringValue(formData, "date"),
    tags: stringValue(formData, "tags").split(",").map((tag) => tag.trim()).filter(Boolean),
    argumentOutcomes,
    evidence,
    reflection: {
      whatWorked: stringValue(formData, "whatWorked"),
      whatFailed: stringValue(formData, "whatFailed"),
      judgeFeedback: stringValue(formData, "judgeFeedback"),
      nextSteps: stringValue(formData, "nextSteps")
    }
  };

  const targetKind = stringValue(formData, "targetKind");
  if (targetKind !== "existing" && targetKind !== "historical") {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: actionMessage("VALIDATION_FAILED"),
      fieldErrors: { targetKind: "Report target is invalid" }
    };
  }

  let command: SaveMatchReportCommand;
  if (targetKind === "existing") {
    const matchId = stringValue(formData, "matchId");
    const expectedRevision = Number(stringValue(formData, "expectedRevision"));
    const targetIssues: Record<string, string> = {};
    if (!matchId) targetIssues.matchId = "Match is required";
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      targetIssues.expectedRevision = "Report revision is invalid";
    }
    if (Object.keys(targetIssues).length) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: actionMessage("VALIDATION_FAILED"),
        fieldErrors: targetIssues
      };
    }
    command = { target: { kind: "existing", matchId, expectedRevision }, report };
  } else {
    command = { target: { kind: "historical" }, report };
  }

  try {
    const result = await saveMatchReport(
      { userId: session.user.id, workspaceId: session.workspace.id },
      command
    );
    revalidatePath("/app/history");
    revalidatePath("/app/matches");
    revalidatePath("/admin/analytics");
    return {
      ok: true,
      message: result.created ? "历史比赛已补录。" : "赛后报告已保存。",
      matchId: result.matchId,
      reportRevision: result.reportRevision
    };
  } catch (error) {
    const code = actionCode(error);
    return {
      ok: false,
      code,
      message: actionMessage(code),
      fieldErrors: issuesFrom(error)
    };
  }
}
