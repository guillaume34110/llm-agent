import React, { useEffect, useState } from 'react';
import MonkeyLogo from './MonkeyLogo';
import { getCurrentAnimal, subscribe } from '../animals/animal-service';
import type { AnimalProfile } from '../animals/registry';

interface Props {
  size?: number;
  animal?: AnimalProfile;
}

export default function AnimalAvatar({ size = 28, animal }: Props) {
  const [current, setCurrent] = useState<AnimalProfile>(animal ?? getCurrentAnimal());

  useEffect(() => {
    if (animal) { setCurrent(animal); return; }
    const unsub = subscribe(a => setCurrent(a));
    return () => { unsub(); };
  }, [animal]);

  if (current.id === 'monkey') {
    return <MonkeyLogo size={size} />;
  }

  return (
    <span
      aria-label={current.name}
      className="inline-flex items-center justify-center"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.85,
        lineHeight: 1,
      }}
    >
      {current.emoji}
    </span>
  );
}
