export function isValidHash(hash: string | undefined) {
  return (
    typeof hash === 'string' && hash !== '.' && hash !== '..' && /^[A-Za-z0-9._-]+$/.test(hash)
  );
}
