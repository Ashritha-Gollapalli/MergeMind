import { Code2, LogOut, FolderKanban } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "../store/authStore";

export default function Navbar() {
  const navigate = useNavigate();

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <header className="navbar">
      <button
        className="brand"
        onClick={() => navigate("/dashboard")}
      >
        <span className="brand-icon">
          <Code2 size={22} />
        </span>

        <span>CodeCollab</span>
      </button>

      <div className="navbar-right">
        <button
          className="nav-link"
          onClick={() => navigate("/dashboard")}
        >
          <FolderKanban size={17} />
          Projects
        </button>

        <div className="user-avatar">
          {user?.username?.charAt(0)?.toUpperCase() || "U"}
        </div>

        <button
          className="icon-button"
          onClick={handleLogout}
          title="Log out"
          aria-label="Log out"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}