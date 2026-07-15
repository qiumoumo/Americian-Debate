"use client";

import { useEffect, useRef, useState } from "react";
import { saveSpeechNote } from "@/app/app/matches/actions";

interface SpeechNoteView {
  id: string;
  speechType: string;
  timerDurationMs: number;
  notes: string;
}

export function SharedSpeechNotes({ notes }: { notes: SpeechNoteView[] }) {
  const [values, setValues] = useState(() => new Map(notes.map((note) => [note.id, note.notes])));
  const dirty = useRef(new Set<string>());

  useEffect(() => {
    setValues((current) => new Map(notes.map((note) => [note.id, dirty.current.has(note.id) ? current.get(note.id) ?? note.notes : note.notes])));
  }, [notes]);

  async function save(noteId: string) {
    const formData = new FormData();
    formData.set("speechNoteId", noteId);
    formData.set("notes", values.get(noteId) ?? "");
    await saveSpeechNote(formData);
    dirty.current.delete(noteId);
  }

  return (
    <div className="table-like note-table">
      <div className="table-row header"><div>Speech</div><div>Notes</div><div>Action</div></div>
      {notes.map((note) => <div className="table-row" key={note.id}>
        <div><strong>{note.speechType}</strong><br /><span className="pill">{Math.round(note.timerDurationMs / 60000)} min</span></div>
        <div><textarea value={values.get(note.id) ?? ""} rows={4} onChange={(event) => { dirty.current.add(note.id); setValues((current) => new Map(current).set(note.id, event.target.value)); }} /></div>
        <div><button className="button" type="button" onClick={() => save(note.id)}>保存</button></div>
      </div>)}
    </div>
  );
}
