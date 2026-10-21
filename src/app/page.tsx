import GuestInbox from "./components/guest-inbox";
import TaskBoard from "./components/task-board";
import Beds24Inbox from "./components/beds24-inbox";

export default function Home() {
  return (
    <>
      <Beds24Inbox />
      <GuestInbox />
      <TaskBoard />
    </>
  );
}