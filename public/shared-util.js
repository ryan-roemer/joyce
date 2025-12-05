// Cache function for memoizing async operations
export const getAndCache = (fn) => {
  let cache;
  return async () => {
    if (!cache) {
      cache = fn();
    }

    return cache;
  };
};
