// Design-lint fixture: comments documenting banned values must never fire the
// lint. The old theme used background: '#000000', shadowColor: '#000' and a
// transition: 'all' — all of that lives in comments here and must be ignored.
export const ok = { backgroundColor: '#050505' };
