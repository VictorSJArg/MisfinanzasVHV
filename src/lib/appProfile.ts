export type AppProfileId = 'victor' | 'esposa';

function profileId(value: string | undefined): AppProfileId {
  return value?.trim().toLowerCase() === 'esposa' ? 'esposa' : 'victor';
}

const id = profileId(process.env.NEXT_PUBLIC_APP_PROFILE);

export const appProfile = {
  id,
  displayName:
    process.env.NEXT_PUBLIC_APP_NAME?.trim() ||
    (id === 'esposa' ? 'Mis Finanzas' : 'Mis Finanzas VHV'),
  isVictor: id === 'victor',
  isEsposa: id === 'esposa'
} as const;
