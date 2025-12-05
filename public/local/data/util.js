/* global fetch:false */
export const fetchWrapper = async (url) => {
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`Failed to fetch posts data: ${err.message}`);
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch/parse posts data (${response.status}): ${response.statusText}`,
    );
  }
  try {
    return await response.json();
  } catch (err) {
    throw new Error(`Failed to parse posts data: ${err.message}`);
  }
};
