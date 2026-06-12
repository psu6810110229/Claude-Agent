import { Files } from "lucide-react";

export default function FilesPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Workspace</p>
          <h2>File Explorer</h2>
        </div>
      </header>
      <div className="placeholder-hero">
        <Files aria-hidden="true" strokeWidth={1.5} />
        <h3>Files are not connected yet</h3>
        <p>
          Approved local file access is a planned capability. Nothing on this
          machine is scanned or read until it is explicitly enabled.
        </p>
      </div>
    </>
  );
}
