import type { SupabaseClient } from "@supabase/supabase-js";
import type { TestBotId } from "./questions.js";

// The owner's good/poor marks on test answers (table bot_test_marks,
// migration 0022).

export type Mark = "good" | "poor";

export interface SavedMark {
  question: string;
  answer: string;
  mark: Mark;
  note: string | null;
  markedAt: Date;
}

export interface MarkStore {
  save(bot: TestBotId, mark: Omit<SavedMark, "markedAt">): Promise<void>;
  /** The newest mark for each question, newest first. */
  latest(bot: TestBotId): Promise<SavedMark[]>;
}

const HOW_MANY = 500;

export function createSupabaseMarkStore(db: SupabaseClient): MarkStore {
  return {
    async save(bot, m) {
      const { error } = await db
        .from("bot_test_marks")
        .insert({ bot, question: m.question, answer: m.answer, mark: m.mark, note: m.note });
      if (error) throw new Error(`saving test mark failed: ${error.message}`);
    },
    async latest(bot) {
      const { data, error } = await db
        .from("bot_test_marks")
        .select("question, answer, mark, note, created_at")
        .eq("bot", bot)
        .order("created_at", { ascending: false })
        .limit(HOW_MANY);
      if (error) throw new Error(`reading test marks failed: ${error.message}`);
      return newestPerQuestion(
        (data ?? []).map((row) => ({
          question: row.question as string,
          answer: row.answer as string,
          mark: row.mark as Mark,
          note: (row.note as string | null) ?? null,
          markedAt: new Date(row.created_at as string),
        })),
      );
    },
  };
}

/** Keeps the first (newest) mark for each question; marks must come newest first. */
export function newestPerQuestion(marks: SavedMark[]): SavedMark[] {
  const seen = new Set<string>();
  return marks.filter((m) => {
    const key = m.question.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
