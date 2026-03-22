import type { CSSProperties } from 'react';
import { AI_PROFILES } from 'holdem/config/aiProfiles';
import styles from 'holdem/components/modals/BotProfileIntro.module.css';

interface BotProfileIntroProps {
  onBack: () => void;
  onConfirm: () => void;
}

export function BotProfileIntro({ onBack, onConfirm }: BotProfileIntroProps) {
  const profiles = Object.values(AI_PROFILES);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.eyebrow}>상대 프로필</span>
          <h2 className={styles.title}>이번 토너먼트 참가자</h2>
          <p className={styles.copy}>이번 게임에는 아래 8가지 성향이 등장합니다. 누가 어떤 성향인지는 플레이 중 공개되지 않습니다.</p>
        </div>

        <div className={styles.grid}>
          {profiles.map((profile) => {
            return (
              <article
                key={profile.id}
                className={styles.card}
                style={{ ['--accent' as const]: profile.color } as CSSProperties}
              >
                <div className={styles.cardTop}>
                  <span className={styles.name}>{profile.name}</span>
                </div>
                <p className={styles.description}>{profile.description}</p>
              </article>
            );
          })}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onBack}>
            뒤로
          </button>
          <button type="button" className={styles.primary} onClick={onConfirm}>
            확인 후 시작
          </button>
        </div>
      </div>
    </div>
  );
}
