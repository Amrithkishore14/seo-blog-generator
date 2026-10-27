/**
 * server/plugins/remove-powered-by.ts
 *
 * Removes the `x-powered-by` response header from every SSR response.
 * Advertising the tech stack in a header provides no user value and gives
 * potential attackers a starting point for version-specific exploits.
 */

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', (response) => {
    delete response.headers['x-powered-by']
    delete response.headers['X-Powered-By']
  })
})
