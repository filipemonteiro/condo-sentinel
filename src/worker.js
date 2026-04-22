export default {
  async fetch(request, env, ctx) {
    return new Response("Condo Sentinel running 🚀", {
      status: 200,
    });
  },
}
