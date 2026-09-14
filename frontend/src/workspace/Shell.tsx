import type { ReactNode } from "react";
import styles from "./style.module.css";

export function WorkspaceShell({ children, navigation }: {
  children: ReactNode;
  navigation?: ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.logo} aria-label="Navo">NAVO<span aria-hidden="true">.</span></span>
      </header>
      <div className={styles.body}>
        {navigation != null && <nav className={styles.navigation} aria-label="主导航">{navigation}</nav>}
        <main className={styles.workspace}>{children}</main>
      </div>
    </div>
  );
}
