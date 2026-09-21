import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/tofu', label: 'FIOLAX Confidence' },
  { to: '/mofu', label: 'FIOLAX Insight' },
  { to: '/bofu', label: 'FIOLAX Experience' },
  // { to: '/demographics', label: 'Demographics'  }, // temporarily hidden
];

export default function NavBar() {
  return (
    <nav className="nav-bar">
      {tabs.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
