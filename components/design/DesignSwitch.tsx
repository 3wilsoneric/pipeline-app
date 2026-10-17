// The approved design is the only runtime path. This compatibility owner can
// disappear with the remaining legacy conditional branches in its callers.
export function useDesignV2() {
  return true;
}
