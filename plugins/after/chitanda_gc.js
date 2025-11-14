let handler = m => m
handler.after = async function (m) {
    if (m.limit) {
        if (m.from == '120363041768083672@g.us' || m.from == '120363025321921305@g.us') {
            m.limit = m.limit * -1
        }
    }
}

export default handler