import { BarChart3, List, Users, Wallet } from 'lucide-react';

export type Tab = 'explore' | 'portfolio' | 'standings' | 'team' | 'admin';
const items = [
  { id: 'explore', label: 'Projects', icon: List },
  { id: 'portfolio', label: 'Portfolio', icon: Wallet },
  { id: 'standings', label: 'Standings', icon: BarChart3 },
  { id: 'team', label: 'My team', icon: Users },
] as const;

export function AppNavigation({
  active,
  organizer,
  mobile = false,
  navigate,
}: {
  active: Tab;
  organizer: boolean;
  mobile?: boolean;
  navigate: (tab: Tab) => void;
}) {
  return (
    <nav
      className={mobile ? 'bottom-nav' : 'main-nav'}
      aria-label={mobile ? 'Mobile navigation' : 'Main navigation'}
    >
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          aria-current={active === id ? 'page' : undefined}
          onClick={() => navigate(id)}
        >
          {mobile && <Icon size={18} />}
          <span>{label}</span>
        </button>
      ))}
      {organizer && !mobile && (
        <button
          aria-current={active === 'admin' ? 'page' : undefined}
          onClick={() => navigate('admin')}
        >
          Admin
        </button>
      )}
    </nav>
  );
}
