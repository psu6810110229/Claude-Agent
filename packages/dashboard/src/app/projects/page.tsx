import { FolderKanban } from "lucide-react";

export default function ProjectsPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-kicker">Workspace</p>
          <h2>Projects</h2>
        </div>
      </header>
      <div className="placeholder-hero">
        <FolderKanban aria-hidden="true" strokeWidth={1.5} />
        <h3>Projects are coming soon</h3>
        <p>
          Group related tasks, notes, and schedules into focused projects. For
          now, Tasks is the single list of record.
        </p>
      </div>
    </>
  );
}
