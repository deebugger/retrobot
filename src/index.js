const { App, directMention } = require('@slack/bolt')
const debug = require('debug')('retrobot')

const DEFAULT_UPVOTES = 3
const plusOrMinus = new RegExp('^[-+]', 'i')

const retroList = {}

// ////////////
// retro object
function initRetro(channelId, bot) {
  let inRetro = true
  const users = {}
  const feedbackMessages = {}
  const trackedMessages = []

  // check that (1) there's some text; (2) that it starts with (-/+); and (3) that it has actual text in it
  const LegitFeedback = (text) => text && plusOrMinus.test(text.trim()) && text.trim().substring(1).trim()

  const getMsgKey = (userId, msgId) => (`${userId}-${msgId}`)

  const getFeedbacks = (startsWith) => {
    const keys = Object.keys(feedbackMessages)
    const filteredKeys = keys.filter(key => feedbackMessages[key]?.text?.trim()?.startsWith(startsWith) || false)
    return filteredKeys.map(key => ({
      text: feedbackMessages[key].text.substring(1).trim(),
      user: feedbackMessages[key].user
    }))
  }

  return {
    stopRetro: () => { inRetro = false },
    isInRetro: () => (inRetro),
    getBot: () => (bot),
    getChannelId: () => (channelId),
    addUser: (user) => { users[user.userId] = user },
    getUsers: () => (users),
    findUser: (userId) => users[userId] || false,
    addFeedback: (userId, ts, text) => {
      if (!LegitFeedback(text)) {
        return false
      }
      feedbackMessages[getMsgKey(userId, ts)] = { user: users[userId], text: text.trim() }
      return true
    },
    updateFeedback: (userId, ts, text) => {
      if (!LegitFeedback(text)) {
        return false
      }
      feedbackMessages[getMsgKey(userId, ts)] = { user: users[userId], text: text.trim() }
      return true
    },
    deleteFeedback: (userId, ts) => {
      delete feedbackMessages[getMsgKey(userId, ts)]
    },
    getWorkedWellFeedback: () => {
      return getFeedbacks('+')
    },
    getNeedsImprovementFeedback: () => {
      return getFeedbacks('-')
    },
    trackMessage: message => { trackedMessages.push(message) },
    getTrackedMessages: () => (trackedMessages)
  }
}

// /////////////////////
// register app behavior
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
})

app.message(directMention(), 'start', start)
app.message(directMention(), 'stop', stop)
app.message(directMention(), 'sum', summary)
app.message(directMention(), 'help', help)
app.message(directMention(), 'wake up', wakeup)
app.message(directMention(), 'wakeup', wakeup)
app.message(directMention(), 'status', status)
app.message(directMention(), 'channels', channels)
app.message(directMention(), 'terminate session', terminateSession)
app.message(handleDirectMessage)

// ////////////////////////////////////////////////
// start a new retro session in the current channel
async function start(params) {
  if (params.event.channel_type === 'im') {
    return
  }

  const channelId = params.payload.channel
  if (retroList[channelId]) {
    if (retroList[channelId].isInRetro()) {
      await params.client.chat.postMessage({ channel: channelId, linkNames: true, text: `:runner: Shucks!
It looks like a retro session is already in progress in this channel.
You can either wait for it to finish, stop it yourself (\`<@${params.context.botUserId}> stop\`) or start a new one in another channel` })
    } else {
      await params.client.chat.postMessage({ channel: channelId, linkNames: true, text: `:hand: Hold on!
It looks like a retro session was stopped but not summarized yet.
You should sum it up (\`<@${params.context.botUserId}> sum\`) or start a new one in another channel` })
    }
    return
  }

  handleStart(params)
}

async function handleStart(params) {
  const channelId = params.payload.channel
  debug('Staring a new session in channel', channelId)

  retroList[channelId] = initRetro(params.payload.channel)

  await params.say(':military_helmet: We\'re starting a new retrospective session - helmets on!')

  const userList = await getConsciousUserList(params)
  Promise.all(userList.map(async user => {
    retroList[channelId].addUser(user)
    return params.client.chat.postMessage({
      channel: user.userId,
      text: `:ear: Ok, I'm all ears!
Tell me what worked well (start with a \`+\`) and what needs improvement (start with a \`-\`).
Each item should be a new line (separated by ENTER).
If you made a mistake, you can edit or delete a message - I'll handle the logistics.

Pro tip: Don't put a space between the \`-\` sign and your first word - it'll turn into a bulleted list (e.g.: \`-no one ate my broccoli cake :-(\`)`
    })
  }))
}

// get a list of all conscious users (active, non-DND channel-mambers), expect the bot user itself
async function getConsciousUserList(params) {
  const userList = await params.client.conversations.members({ channel: params.payload.channel })
  if (!userList.ok) {
    await params.say(':poop: Oy vey! Some error has occured - I can\'t find anyone in this channel. Aborting operation.')
    return []
  }

  try {
    const conciousUsers = await Promise.all(userList.members.map(userId => {
      if (userId === params.context.botUserId) {
        // skip this bot's user
        return false
      }
      return getConsciousUser(userId, params.client)
    }))

    return conciousUsers.filter(Boolean)
  } catch (err) {
    debug('Error caught in getConsciousUsers: %O', { err })
    await params.say(':poop: Oy vey! Some error has occured - I can\'t find anyone in this channel. Aborting operation.')
    return []
  }
}

// a councious user is a user that isn't "away" and is not in a "Do not disturb" (DND) mode right now
async function getConsciousUser(userId, client) {
  const now = Date.now() / 1000
  try {
    const dnd = await client.dnd.info({ user: userId })
    if (!dnd.ok || (dnd.next_dnd_start_ts < now && now < dnd.next_dnd_end_ts)) {
      return false
    }
    const presence = await client.users.getPresence({ user: userId })
    if (!presence.ok || presence.presence !== 'active') {
      return false
    }
    const userInfo = await client.users.info({ user: userId })
    return { userId, name: userInfo.user.name }
  } catch (err) {
    debug('Error caught in getConsciousUser: %O', { userId, err })
    // something went wrong - just skip this user
    return false
  }
}

// ///////////////////////////////////////////////////
// stop a running retro session in the current channel
async function stop(params) {
  if (params.event.channel_type === 'im') {
    return
  }

  const channelId = params.payload.channel

  if (!retroList[channelId] || !retroList[channelId].isInRetro()) {
    await params.client.chat.postMessage({ channel: channelId, linkNames: true, text: `:face_with_raised_eyebrow: That's funny..
I don't remember running an active retro for this channel at this time.
Maybe you forgot to start one? You can do that by typing \`<@${params.context.botUserId}> start\`)` })
    return
  }

  handleStop(params)
}

async function handleStop(params) {
  const channelId = params.payload.channel
  debug('Stopping a session in channel', channelId)

  await params.say(':grinning_face_with_star_eyes: Let\'s gather everyone back - I\'ll start printing all the feedback I got shortly.')

  retroList[channelId].stopRetro()

  const users = retroList[channelId].getUsers()
  Promise.all(Object.values(users).map(async user => {
    return params.client.chat.postMessage({
      channel: user.userId,
      text: `:hand: We're done here!
Get back to the retro channel at <#${channelId}>` })
  }))

  printFeedback(params)
}

async function printFeedback(params) {
  const channelId = params.payload.channel

  await params.say(`====================================================================================================
:sparkles: What worked well :sparkles:`)
  const workedWellFeedback = shuffleArray(retroList[channelId].getWorkedWellFeedback())
  await Promise.all(workedWellFeedback.map(async (feedback) => {
    return params.say(`${feedback.text} (${feedback.user.name})`)
  }))

  await params.say(`====================================================================================================
:construction: What needs improvement :construction:`)
  const needsImprovementFeedback = shuffleArray(retroList[channelId].getNeedsImprovementFeedback())
  await Promise.all(needsImprovementFeedback.map(async (feedback) => {
    const msg = await params.say(`${feedback.text} (${feedback.user.name})`)
    retroList[channelId].trackMessage(msg)
  }))

  await params.say(`====================================================================================================
:hourglass_flowing_sand: It's go time - start voting!
Use :+1: to upvote items that you want to discuss from the "Needs improvement" pile.

Once everyone has voted, someone should type \`<@${params.context.botUserId}> sum [N]\` to sum up the top [N] most voted-upon items (default is 3).`)
}

function shuffleArray(array) {
  array.sort(() => Math.random() + 0.5 > 1 ? 1 : -1);
  return array;
}

// ///////////////////////////////////////////////
// sum up the retro session in the current channel
async function summary(params) {
  if (params.event.channel_type === 'im') {
    return
  }

  const channelId = params.payload.channel

  if (!retroList[channelId]) {
    await params.say(`:thinking_face: Sum up what?
There's no retro session running here.
You can start one by typing \`<@${params.context.botUserId}> start\`.`)
    return
  }

  if (retroList[channelId].isInRetro()) {
    await params.say(`:hand: Hey, wait a minute!
This retro is still in session.
You should stop it first (\`<@${params.context.botUserId}> stop\`) and then run \`<@${params.context.botUserId}> sum\``)
    return
  }

  handleSummary(params)
}

async function handleSummary(params) {
  const channelId = params.payload.channel
  debug('Summing up session in channel', channelId)

  // parse out the number of maximum upvotes to print
  const maxUpvotes = Number(params.message.text.substring(params.message.text.indexOf('sum') + 3).trim()) || DEFAULT_UPVOTES

  // get a sorted, sliced list of tracked ("needs improvement") messages that were up-voted
  // (a bit of a functional train wreck, but it was fun to write..)
  const trackedMessages = retroList[channelId].getTrackedMessages()
  const reactions = await Promise.all(trackedMessages.map(msg => params.client.reactions.get({
    channel: channelId,
    timestamp: msg.ts
  })))
  const withPlusones = reactions
    .map(msg => ({
      text: msg.message?.text,
      plusones: msg.message?.reactions?.filter(r => r.name === '+1') || []
    }))
    .filter(r => r.plusones.length > 0)
    .slice(0, maxUpvotes)
  const sortedPlusones = withPlusones.sort((a,b) => a.plusones[0].count > b.plusones[0].count ? -1 : 1)

  // print all the vp-voted messages, along with the number of 👍 that each got
  const numUpvotes = Math.min(maxUpvotes, sortedPlusones.length)
  await params.say(`:mega: Below are the ${numUpvotes} most voted-upon messages from the "Needs improvement" pile.

Pro tip: You can discuss them and leave summaries and action items in each message's thread, to be followed-up in the next retro session.`)
  for (const index in sortedPlusones) {
    const msg = sortedPlusones[index]
    const numVotes = msg.plusones[0].count
    await params.say(`${':+1:'.repeat(numVotes)} ${msg.text}`)
  }

  await params.say(`
Well, I guess this is goodbye.. See you next time! :wave: `)
  delete retroList[channelId]
}

// ////////////////////
// print some help text
async function help(params) {
  if (params.event.channel_type === 'im') {
    return
  }

  await params.say(`:paperclip: It looks like you need some help!

Here are the commands I support, and how to use them:
\`<@${params.context.botUserId}> start\` - this is how you start a new retro session (you need me in this channel too, so don't forget to invite me first)
\`<@${params.context.botUserId}> stop\` - once everyone has given feedback, call this to gather all of it and present it for everyone to vote on
\`<@${params.context.botUserId}> sum [N]\` - after everyone has voted, print the most [N] (default: ${DEFAULT_UPVOTES}) voted messages that are in the "Needs improvement" pile, and end the session
\`<@${params.context.botUserId}> help\` - shows this help message, obviously
\`<@${params.context.botUserId}> wake up\` - pings Retrobot, in case it was sleeping
\`<@${params.context.botUserId}> status\` - show the status of the retro session in this channel, if it's in progress
\`<@${params.context.botUserId}> channels\` - show a list of all the channels that I'm currently running retro sessions in, and what stage they're in
\`<@${params.context.botUserId}> terminate session\` - :warning: this will immediately TERMINATE the retro session in this channel - WITHOUT EXTRA CONFIRMATION! :warning:

I hope that helped!`)
}

// ////////////////
// wake retrobot up
async function wakeup(params) {
  if (params.event.channel_type === 'im') {
    return
  }

  await params.say(`I'm up, I'm up! I wasn't sleeping anyway.. :yawning_face:`)
}

// /////////////////////////////////////////////////////////
// print the status of the retro in this channel (if exists)
async function status(params) {
  if (params.event.channel_type === 'im') {
    return
  }

  const channelId = params.payload.channel
  if (!retroList[channelId]) {
    await params.say(':shrug: Nope, nada, zilch - no retro sessions in this channel.')
  } else if (retroList[channelId].isInRetro()) {
    await params.say(':shushing_face: Shhh! A retro session is currently running in this channel, and everyone\'s busy giving feedback. Try not to interrupt!')
  } else {
    await params.say(':point_up: A retro session is currently being voted upon in this channel. You can idly stand by or join the process - up to you!')
  }
}

// ///////////////////////////////////////////////////////////////
// list all the channels where a retro session is now taking place
async function channels(params) {
  if (params.event.channel_type === 'im') {
    return
  }

  const channels = Object.keys(retroList)
  if (channels.length === 0) {
    await params.say(':shrug: There are no retro sessions currently running.')
    return
  }

  handleChannels(params)
}

async function handleChannels(params) {
  debug('Printing channels output')
  const channels = Object.keys(retroList)

  await params.say(':mag_right: Here are the channels in which a retro session is currently in progress:')
  Promise.all(channels.map(async channelId =>
    (params.say(`<#${channelId}> (${retroList[channelId].isInRetro() ? 'getting feedback' : 'voting'})`))))
}

// ///////////////////////////////////////////////////////////////////////////////////////////////////////
// immediately end the retro session in the current channel (useful when stuff goes wrong for some reason)
async function terminateSession(params) {
  if (params.event.channel_type === 'im') {
    return
  }

  const channelId = params.payload.channel

  if (!retroList[channelId]) {
    await params.say(`:confused: I'm bit confused here - there's no running retro session in this channel`)
    return
  }

  debug('Terminating retro session', channelId)
  handleTerminateSession(params)
}

async function handleTerminateSession(params) {
  const channelId = params.payload.channel

  const users = retroList[channelId].getUsers()
  Promise.all(Object.values(users).map(async user => {
    return params.client.chat.postMessage({
      channel: user.userId,
      text: `:warning: Someone has cut the session short!
Get back to the retro channel at <#${channelId}>` })
  }))

  delete retroList[channelId]

  await params.say('Ok, I completely removed the current retro session. See you next time! :wave:')
}

// ///////////////////////////////////////////////////////////////
// handle (only) direct messages from users during a retro session
async function handleDirectMessage(params) {
  if (params.event.channel_type !== 'im') {
    return
  }

  const retroChannels = Object.keys(retroList)
  if (retroChannels.length === 0) {
    await params.say(':no_entry_sign: Sorry - there aren\'t any retro sessions in progress right now.')
    return
  }

  // caveat: if a user is somehow in more than a single retro session,
  // the first matching session on the list gets the feedback
  const userId = params.event.user || params.event.previous_message?.user
  const retroChannel = retroChannels.filter(channel => retroList[channel].findUser(userId))[0]
  if (!retroChannel) {
    await params.say(':no_entry_sign: Sorry, I couldn\'t find you in any retro session.')
    return
  }

  debug('Collecting feedback for session in channel', retroChannel)

  const errMsg = `:hand: You can only send two types of feedbacks: \`+<something that went well>\`, or \`-<something that needs improvement>\``
  if (params.event.subtype === 'message_changed') {
    if (!retroList[retroChannel].updateFeedback(userId, params.message.message.ts, params.message.message.text)) {
      await params.say(errMsg)
    }
  } else if (params.event.subtype === 'message_deleted') {
    retroList[retroChannel].deleteFeedback(userId, params.message.deleted_ts)
  } else if (!retroList[retroChannel].addFeedback(userId, params.message.ts, params.message.text)) {
    await params.say(errMsg)
  }
}

// ///////////////////
// start your engines!
(async () => {
  // Start the app
  await app.start(process.env.PORT || 3000)

  console.log('🤖 Retrobot is running! 🦾')
})()
