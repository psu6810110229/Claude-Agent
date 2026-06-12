import { NotebookPen } from "lucide-react";

export default function NotepadPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Workspace</p>
          <h2>Notepad</h2>
        </div>
      </header>
      <div className="placeholder-hero">
        <NotebookPen aria-hidden="true" strokeWidth={1.5} />
        <h3>Notes are coming soon</h3>
        <p>
          A quiet place for quick notes and longer thinking. Until then, the
          Memory page holds durable, human-readable notes.
        </p>
      </div>
    </>
  );
}
