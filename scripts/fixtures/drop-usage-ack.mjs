const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const response = await realFetch(input, options);
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.pathname === "/api/research-usage" && response.ok) {
    await response.json();
    throw new Error("Usage acknowledgement lost after commit.");
  }
  return response;
};
