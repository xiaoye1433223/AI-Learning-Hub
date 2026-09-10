import { dataMode, request } from './client'

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

const MOCK_REPLIES: Array<{ pattern: RegExp; replies: string[] }> = [
  {
    pattern: /学时|积分|成长/i,
    replies: ['学时 = 成长积分 ÷ 10（每 1 学时 = 10 积分）🐾 看视频、做课程、发帖分享都会积累。 weekly 榜单统计的是最近 7 天哦～', '在「学时排名」页可以看个人榜和高校榜 🏆 每天坚持学习 + 分享笔记，积分自然会涨！'],
  },
  {
    pattern: /计划|规划|怎么学|安排/i,
    replies: ['试试「三明治学习法」🥪 上学前看 15 分钟新知识 → 课后立刻动手练 → 睡前 10 分钟回忆复盘。要更细的计划可以告诉我你的目标！', '建议把大目标拆成每天 25 分钟的小任务，完成一个就在社区打个卡，坚持一周就能看到变化 ⏰'],
  },
  {
    pattern: /实验|环境|实训|lab/i,
    replies: ['实训项目的环境都是开箱即用的 🧪 打开实验页点「进入环境」，第一次启动会稍慢，属正常现象。卡住了随时来问我！', '做实验时建议先读一遍任务目标再动手，做完记得提交实验记录，这些都会算进你的成长档案 📈'],
  },
  {
    pattern: /提问|社区|发帖|投稿|社区怎么/i,
    replies: ['在社区点「分享学习收获」就能发帖啦 ✍️ 问题描述得越具体（做了什么、卡在哪、报什么错），越容易获得高质量回答～', '提问小技巧：附上你尝试过的方案和报错截图，别人能更快帮你定位问题 💡 回答被采纳还能涨积分！'],
  },
  {
    pattern: /你好|您好|嗨|hello|hi|在吗|你是谁/i,
    replies: ['嗨嗨～我是雪豹助手 🐆✨ 学习答疑、找资料、定计划都可以找我！', '在呢在呢！今天想搞懂点什么？😄'],
  },
  {
    pattern: /谢谢|感谢|thanks/i,
    replies: ['不客气～学有所获记得去社区分享，能帮到更多同学 🧡', '小事一桩！有新问题随时摇一摇右下角的我 😎'],
  },
]

const GENERIC_REPLIES = [
  '这个问题有点意思 🤔 先搞清楚「它解决什么问题」，再看看「它是怎么解决的」，最后试着复述一遍——三步下来基本就吃透了。你现在卡在哪一步？',
  '试试把问题拆小一点？先记住它的一句话定义，再找一个小例子跑一遍。把你的理解发给我，我帮你看看有没有偏差 🔍',
  '换个角度想：如果让你给完全没接触过的同学讲明白这个概念，你会怎么说？讲得出来就是真懂了，讲不出来说明还差一块拼图 🧩',
  '好问题！教程中心有对应的系统资料，边看边动手最快。需要我帮你把知识点排个学习顺序吗？',
]

const mockReply = (question: string): string => {
  const hit = MOCK_REPLIES.find((entry) => entry.pattern.test(question))
  const pool = hit ? hit.replies : GENERIC_REPLIES
  return pool[Math.floor(Math.random() * pool.length)]
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const assistantApi = {
  /**
   * 发送提问，返回助手回复文本。
   * API 模式走真实后端（预留 POST /api/v1/assistant/chat，后端部署前自动回退演示回复）；
   * Mock 模式直接本地生成演示回复。任何密钥都不允许出现在前端。
   */
  async send(question: string, history: AssistantMessage[] = []): Promise<string> {
    if (dataMode === 'api') {
      try {
        const result = await request<{ reply: string }>('/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, history }),
        })
        if (typeof result?.reply === 'string' && result.reply.trim()) return result.reply.trim()
      } catch { /* 后端接口就绪前回退演示回复 */ }
    }
    await wait(700 + Math.random() * 700)
    return mockReply(question)
  },
}
