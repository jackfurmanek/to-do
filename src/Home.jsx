import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { isOverdue } from './model.js'

// Greetings by time of day, plus some that work any time. One is picked at random
// each time the app loads, from the current time slot's list and the anytime list.
const GREETINGS = {
  morning: [ // 5am–noon
    'Good morning',
    'Morning. Coffee first?',
    'Rise and shine',
    'Fresh start',
  ],
  afternoon: [ // noon–5pm
    'Good afternoon',
    'Afternoon',
    "Hope the day's treating you well",
  ],
  evening: [ // 5pm–10pm
    'Good evening',
    'Evening',
    'Winding down?',
  ],
  night: [ // 10pm–5am
    'Burning the midnight oil?',
    'Still up?',
    'Hey there, night owl',
  ],
  anytime: [
    'Greetings',
    'Hello',
    'Hey there',
    'Welcome back',
    'Good to see you',
    "What's on the list?",
    "Let's get things done",
  ],
}

function timeSlot(hour) {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

const LAST_KEY = 'todo-greeting-last'

// Random greeting for right now, avoiding the one shown last time where possible.
// Pure (no saving here): React may call it twice in development.
function pickGreeting() {
  const pool = [...GREETINGS[timeSlot(new Date().getHours())], ...GREETINGS.anytime]
  let last = null
  try {
    last = localStorage.getItem(LAST_KEY)
  } catch {}
  const choices = pool.filter((g) => g !== last)
  return choices[Math.floor(Math.random() * choices.length)]
}

function summary(tabs, today) {
  let dueToday = 0
  let overdue = 0
  for (const tab of tabs)
    for (const col of tab.columns)
      for (const item of col.items) {
        if (item.due === today) dueToday++
        else if (isOverdue(item, today)) overdue++
      }
  const parts = []
  if (dueToday) parts.push(`${dueToday} ${dueToday === 1 ? 'thing' : 'things'} due today`)
  if (overdue) parts.push(`${overdue} overdue`)
  return parts.length ? parts.join(' · ') : 'Nothing due today.'
}

const word = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { type: 'spring', bounce: 0.2, duration: 0.7 } },
}

// The page behind the tabs: a greeting and a one-line look at what's due.
export default function Home({ tabs, today, bottomSpace }) {
  const [greeting] = useState(pickGreeting)
  // Remember the one actually shown, so the next load picks a different one.
  useEffect(() => {
    try {
      localStorage.setItem(LAST_KEY, greeting)
    } catch {}
  }, [greeting])

  return (
    <main className="main" style={{ paddingBottom: bottomSpace }}>
      <motion.h1
        className="greeting"
        aria-label={greeting}
        initial="hidden"
        animate="shown"
        transition={{ staggerChildren: 0.07, delayChildren: 0.1 }}
      >
        {greeting.split(' ').map((w, i) => (
          <motion.span key={i} variants={word} aria-hidden="true">
            {w}{' '}
          </motion.span>
        ))}
      </motion.h1>
      <motion.p
        className="muted"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: 0.2 + greeting.split(' ').length * 0.07, duration: 0.5 } }}
      >
        {summary(tabs, today)}
      </motion.p>
    </main>
  )
}
