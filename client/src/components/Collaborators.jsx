import { Users } from "lucide-react";
import RoleBadge from "./RoleBadge";

export default function Collaborators({
  members = [],
  currentUserId,
}) {
  return (
    <section className="collaborators-panel">
      <div className="panel-heading">
        <Users size={17} />
        <h3>Collaborators</h3>
        <span>{members.length}</span>
      </div>

      <div className="collaborator-list">
        {members.map((member) => {
          const user = member.user || member;

          const name = user.username || "Unknown user";

          return (
            <div
              className="collaborator-item"
              key={user._id || user.id}
            >
              <div className="collaborator-avatar">
                {name.charAt(0).toUpperCase()}
              </div>

              <div className="collaborator-info">
                <span className="collaborator-name">
                  {name}
                  {(user._id || user.id) === currentUserId && (
                    <span className="you-label">You</span>
                  )}
                </span>

                <RoleBadge role={member.role || "EDITOR"} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}