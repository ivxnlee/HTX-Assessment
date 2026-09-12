import { Route, Routes } from "react-router-dom";
import TaskList from "./pages/TaskList";
import TaskCreate from "./pages/TaskCreate";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <main>
        <Routes>
          <Route path="/" element={<TaskList />} />
          <Route path="/tasks/new" element={<TaskCreate />} />
          <Route path="*" element={<TaskList />} />
        </Routes>
      </main>
    </div>
  );
}
