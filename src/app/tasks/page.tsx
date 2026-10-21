import { AppShell } from "@/components/app-shell";
import { TasksBoard } from "@/components/tasks-board";

export default function TasksPage() {
  return (
    <AppShell>
      <TasksBoard />
    </AppShell>
  );
}
