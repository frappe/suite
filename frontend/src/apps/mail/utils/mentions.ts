import * as cheerio from 'cheerio'

// The editor's mention nodes are internal markup: a `<span class="mention">` styled by
// our own stylesheet, which no recipient's client has. Send them as mailto links over
// the same `@Name` text, so a mention still reads as the person it names — and resolves
// to them — wherever the mail lands.
export const flattenMentions = ($: cheerio.CheerioAPI) => {
  $('span[data-type="mention"]').each((_, span) => {
    const $mention = $(span)
    const email = $mention.attr('data-id')
    if (!email) return

    $mention.replaceWith(
      $('<a></a>')
        .attr('href', `mailto:${email}`)
        .text($mention.text() || `@${$mention.attr('data-label') || email}`),
    )
  })
}
