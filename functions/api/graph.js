export async function onRequestGet({ env, request }) {
  try {
    const assetUrl = new URL('/recipes-global.json', request.url);
    return env.ASSETS.fetch(assetUrl);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
