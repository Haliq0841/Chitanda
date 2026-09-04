const handler = async (m, { conn, args, usedPrefix, thisClass, db, command }) => {
    let tags = {}
    const user = db.getUser?.(m.sender) || db.data.users[m.sender] || {}
    const defaultMenu = {
      before: 'Berikut adalah daftar menu yang tersedia:',
      header: '%category:',
      body: '%cmd %islimit %isPremium',
      footer: '',
      after: 'Sisa Limit kamu saat ini: ' + Number(user.limit || 0)
    }

    const pluginList = Array.isArray(thisClass?.plugins)
      ? thisClass.plugins
      : thisClass?.plugins instanceof Map
        ? [...thisClass.plugins.values()]
        : Object.values(thisClass?.plugins || {})

    let help = pluginList
      .filter(Boolean)
      .filter(plugin => !plugin.disabled)
      .map(plugin => {
        const rawHelp = Array.isArray(plugin.help) ? plugin.help : [plugin.help].filter(Boolean)
        const rawTags = Array.isArray(plugin.tags) ? plugin.tags : [plugin.tags].filter(Boolean)

        return {
          help: rawHelp.length ? rawHelp : [''],
          tags: rawTags.length ? rawTags : ['main'],
          prefix: 'customPrefix' in plugin,
          limit: !!plugin.limit,
          premium: !!plugin.premium,
          enabled: !plugin.disabled,
        }
      })

    for (let plugin of help) {
      if (!plugin || !Array.isArray(plugin.tags)) continue
      for (let tag of plugin.tags) {
        if (!tag) continue
        tags[tag] = tag
      }
    }

    let _text = [
      defaultMenu.before,
      ...Object.keys(tags).map(tag => {
        const categoryItems = help.filter(menu => menu.tags && menu.tags.includes(tag) && menu.help.some(Boolean))
        const lines = categoryItems.flatMap(menu => {
          return menu.help.map(helpText => {
            const cmd = (menu.prefix ? helpText : (usedPrefix || '.') + helpText).trim()
            return defaultMenu.body
              .replace(/%cmd/g, cmd)
              .replace(/%islimit/g, menu.limit ? 'Ⓛ' : '')
              .replace(/%isPremium/g, menu.premium ? '℗' : '')
              .trim()
          })
        })

        return [
          defaultMenu.header.replace(/%category/g, tags[tag]),
          ...lines,
          defaultMenu.footer
        ].join('\n')
      }),
      defaultMenu.after
    ].join('\n')

    await m.reply(_text)
};

handler.help = ['menu'];
handler.tags = ['main'];
handler.command = /^(menu|help|\?)$/i;

export default handler;