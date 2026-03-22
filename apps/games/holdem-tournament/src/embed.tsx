import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { type HoldemTournamentAppProps } from 'holdem/app/App';
import 'holdem/styles/variables.css';
import 'holdem/styles/globals.css';

export type HoldemTournamentEmbedProps = Omit<HoldemTournamentAppProps, 'layoutMode'> & {
  layoutMode?: 'embedded';
};

export function HoldemTournamentEmbed(props: HoldemTournamentEmbedProps) {
  return <App {...props} layoutMode="embedded" />;
}

export interface HoldemTournamentMountHandle {
  unmount: () => void;
}

export interface HoldemTournamentMountOptions extends HoldemTournamentEmbedProps {
  strictMode?: boolean;
}

export function mountHoldemTournament(
  container: Element,
  { strictMode = true, ...props }: HoldemTournamentMountOptions = {},
): HoldemTournamentMountHandle {
  const root = ReactDOM.createRoot(container);
  const app = <HoldemTournamentEmbed {...props} />;

  root.render(strictMode ? <React.StrictMode>{app}</React.StrictMode> : app);

  return {
    unmount: () => root.unmount(),
  };
}
