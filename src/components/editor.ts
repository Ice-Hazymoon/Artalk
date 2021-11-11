import '../style/editor.less'

import Context from '../context'
import Component from '../lib/component'
import * as Utils from '../lib/utils'
import * as Ui from '../lib/ui'
import EditorHTML from './html/editor.html?raw'

import EmoticonsPlug from './editor-plugs/emoticons-plug'
import { CommentData } from '~/types/artalk-data'
import Api from '../api'

export default class Editor extends Component {
  private readonly LOADABLE_PLUG_LIST = [EmoticonsPlug]
  public plugList: { [name: string]: any } = {}

  public $header: HTMLElement
  public $textareaWrap: HTMLElement
  public $textarea: HTMLTextAreaElement
  public $closeComment: HTMLTextAreaElement
  public $plugWrap: HTMLElement
  public $bottom: HTMLElement
  public $bottomPartLeft: HTMLElement
  public $plugSwitcherWrap: HTMLElement
  public $bottomPartRight: HTMLElement
  public $submitBtn: HTMLButtonElement
  public $notifyWrap: HTMLElement

  private replyComment: CommentData|null = null
  private $sendReply: HTMLElement|null = null

  private get user () {
    return this.ctx.user
  }

  constructor (ctx: Context) {
    super(ctx)

    this.$el = Utils.createElement(EditorHTML)

    this.$header = this.$el.querySelector('.atk-editor-header')!
    this.$textareaWrap = this.$el.querySelector('.atk-editor-textarea-wrap')!
    this.$textarea = this.$el.querySelector('.atk-editor-textarea')!
    this.$closeComment = this.$el.querySelector('.atk-close-comment')!
    this.$plugWrap = this.$el.querySelector('.atk-editor-plug-wrap')!
    this.$bottom = this.$el.querySelector('.atk-editor-bottom')!
    this.$bottomPartLeft = this.$el.querySelector('.atk-editor-bottom-part.atk-left')!
    this.$plugSwitcherWrap = this.$el.querySelector('.atk-editor-plug-switcher-wrap')!
    this.$bottomPartRight = this.$el.querySelector('.atk-editor-bottom-part.atk-right')!
    this.$submitBtn = this.$el.querySelector('.atk-send-btn')!
    this.$notifyWrap = this.$el.querySelector('.atk-editor-notify-wrap')!

    this.initLocalStorage()
    this.initHeader()
    this.initTextarea()
    this.initEditorPlug()
    this.initBottomPart()

    // 监听事件
    this.ctx.on('editor-open', () => (this.open()))
    this.ctx.on('editor-close', () => (this.close()))
    this.ctx.on('editor-reply', (commentData) => (this.setReply(commentData)))
    this.ctx.on('editor-show-loading', () => (Ui.showLoading(this.$el)))
    this.ctx.on('editor-hide-loading', () => (Ui.hideLoading(this.$el)))
    this.ctx.on('editor-notify', (f) => (this.showNotify(f.msg, f.type)))
  }

  initLocalStorage () {
    const localContent = window.localStorage.getItem('ArtalkContent') || ''
    if (localContent.trim() !== '') {
      this.showNotify('已自动恢复', 'i')
      this.setContent(localContent)
    }
    this.$textarea.addEventListener('input', () => {
      this.saveContent()
    })
  }

  initHeader () {
    Object.keys(this.user.data).forEach((field) => {
      const inputEl = this.getInputEl(field)
      if (inputEl && inputEl instanceof HTMLInputElement) {
        inputEl.value = this.user.data[field] || ''
        // 绑定事件
        inputEl.addEventListener('input', () => this.onHeaderInputChanged(field, inputEl))
      }
    })
  }

  getInputEl (field: string) {
    const inputEl = this.$header.querySelector<HTMLInputElement>(`[name="${field}"]`)
    return inputEl
  }

  queryUserInfo = {
    timeout: <number|null>null,
    abortFunc: <(() => void)|null>null
  }

  /** header 输入框内容变化事件 */
  onHeaderInputChanged (field: string, inputEl: HTMLInputElement) {
    this.user.data[field] = inputEl.value.trim()

    // 若修改的是 nick or email
    if (field === 'nick' || field === 'email') {
      this.user.data.token = '' // 清除 token 登陆状态
      this.user.data.isAdmin = false

      // 获取用户信息
      if (this.queryUserInfo.timeout !== null) window.clearTimeout(this.queryUserInfo.timeout) // 清除待发出的请求
      if (this.queryUserInfo.abortFunc !== null) this.queryUserInfo.abortFunc() // 之前发出未完成的请求立刻中止

      this.queryUserInfo.timeout = window.setTimeout(() => {
        this.queryUserInfo.timeout = null // 清理

        const {req, abort} = new Api(this.ctx).userGet(
          this.user.data.nick, this.user.data.email
        )
        this.queryUserInfo.abortFunc = abort
        req.then(data => {
          if (!data.is_login) {
            this.user.data.token = ''
            this.user.data.isAdmin = false
          }

          // 未读消息更新
          this.ctx.trigger('unread-update', { notifies: data.unread, })

          // 若用户为管理员，执行登陆操作
          if (this.user.checkHasBasicUserInfo() && !data.is_login && data.user && data.user.is_admin) {
            this.showLoginDialog()
          }

          // 自动填入 link
          if (data.user && data.user.link) {
            this.user.data.link = data.user.link
            this.getInputEl('link')!.value = data.user.link
          }
        })
        .finally(() => {
          this.queryUserInfo.abortFunc = null // 清理
        })
      }, 400) // 延迟执行，减少请求次数
    }

    this.saveUser()
  }

  showLoginDialog () {
    this.ctx.trigger('checker-admin', {
      onSuccess: () => {
      }
    })
  }

  saveUser () {
    this.user.save()
    this.ctx.trigger('user-changed', this.ctx.user.data)
  }

  saveContent () {
    window.localStorage.setItem('ArtalkContent', this.getContentOriginal().trim())
  }

  initTextarea () {
    // 占位符
    this.$textarea.placeholder = this.ctx.conf.placeholder || ''

    // 修复按下 Tab 输入的内容
    this.$textarea.addEventListener('keydown', (e) => {
      const keyCode = e.keyCode || e.which

      if (keyCode === 9) {
        e.preventDefault()
        this.insertContent('\t')
      }
    })

    // 输入框高度随内容而变化
    this.$textarea.addEventListener('input', (evt) => {
      this.adjustTextareaHeight()
    })
  }

  adjustTextareaHeight () {
    const diff = this.$textarea.offsetHeight - this.$textarea.clientHeight
    this.$textarea.style.height = '0px' // it's a magic. 若不加此行，内容减少，高度回不去
    this.$textarea.style.height = `${this.$textarea.scrollHeight + diff}px`
  }

  openedPlugName: string|null = null

  initEditorPlug () {
    this.plugList = {}
    this.$plugWrap.innerHTML = ''
    this.$plugWrap.style.display = 'none'
    this.openedPlugName = null
    this.$plugSwitcherWrap.innerHTML = ''

    // 依次实例化 plug
    this.LOADABLE_PLUG_LIST.forEach((PlugObj) => {
      const plug = new PlugObj(this)
      this.plugList[plug.getName()] = plug

      // 切换按钮
      const btnElem = Utils.createElement(`<span class="atk-editor-action atk-editor-plug-switcher">${plug.getBtnHtml()}</span>`)
      this.$plugSwitcherWrap.appendChild(btnElem)
      btnElem.addEventListener('click', () => {
        this.$plugSwitcherWrap.querySelectorAll('.active').forEach(item => item.classList.remove('active'))

        // 若点击已打开的，则收起
        if (plug.getName() === this.openedPlugName) {
          plug.onHide()
          this.$plugWrap.style.display = 'none'
          this.openedPlugName = null
          return
        }

        if (this.$plugWrap.querySelector(`[data-plug-name="${plug.getName()}"]`) === null) {
          // 需要初始化
          const plugEl = plug.getEl()
          plugEl.setAttribute('data-plug-name', plug.getName())
          plugEl.style.display = 'none'
          this.$plugWrap.appendChild(plugEl)
        }

        (Array.from(this.$plugWrap.children) as HTMLElement[]).forEach((plugItemEl: HTMLElement) => {
          const plugItemName = plugItemEl.getAttribute('data-plug-name')!
          if (plugItemName === plug.getName()) {
            plugItemEl.style.display = ''
            this.plugList[plugItemName].onShow()
          } else {
            plugItemEl.style.display = 'none'
            this.plugList[plugItemName].onHide()
          }
        })

        this.$plugWrap.style.display = ''
        this.openedPlugName = plug.getName()

        btnElem.classList.add('active')
      })
    })
  }

  /** 关闭编辑器插件 */
  closePlug () {
    this.$plugWrap.innerHTML = ''
    this.$plugWrap.style.display = 'none'
    this.openedPlugName = null
  }

  insertContent (val: string) {
    if ((document as any).selection) {
      this.$textarea.focus();
      (document as any).selection.createRange().text = val
      this.$textarea.focus()
    } else if (this.$textarea.selectionStart || this.$textarea.selectionStart === 0) {
      const sStart = this.$textarea.selectionStart
      const sEnd = this.$textarea.selectionEnd
      const sT = this.$textarea.scrollTop
      this.setContent(this.$textarea.value.substring(0, sStart) + val + this.$textarea.value.substring(sEnd, this.$textarea.value.length))
      this.$textarea.focus()
      this.$textarea.selectionStart = sStart + val.length
      this.$textarea.selectionEnd = sStart + val.length
      this.$textarea.scrollTop = sT
    } else {
      this.$textarea.focus()
      this.$textarea.value += val
    }
  }

  setContent (val: string) {
    this.$textarea.value = val
    this.saveContent()
    if (!!this.plugList && !!this.plugList.preview) {
      this.plugList.preview.updateContent()
    }
    this.adjustTextareaHeight()
  }

  clearEditor () {
    this.setContent('')
    this.cancelReply()
  }

  getContent () {
    let content = this.getContentOriginal()

    // 表情包处理
    if (this.plugList && this.plugList.emoticons) {
      const emoticonsPlug = this.plugList.emoticons as EmoticonsPlug
      content = emoticonsPlug.transEmoticonImageText(content)
    }

    return content
  }

  getContentOriginal () {
    return this.$textarea.value || '' // Tip: !!"0" === true
  }

  initBottomPart () {
    this.initReply()
    this.initSubmit()
  }

  initReply () {
    this.replyComment = null
    this.$sendReply = null
  }

  setReply (commentData: CommentData) {
    if (this.replyComment !== null) {
      this.cancelReply()
    }

    if (this.$sendReply === null) {
      this.$sendReply = Utils.createElement('<div class="atk-send-reply-wrap"><div class="atk-send-reply">回复 <span class="atk-text"></span><span class="atk-cancel" title="取消 AT">×</span></div></div>');
      this.$sendReply.querySelector<HTMLElement>('.atk-text')!.innerText = `@${commentData.nick}`
      this.$sendReply.addEventListener('click', () => {
        this.cancelReply()
      })
      this.$textareaWrap.prepend(this.$sendReply)
    }
    this.replyComment = commentData
    Ui.scrollIntoView(this.$el)
    this.$textarea.focus()
  }

  cancelReply () {
    if (this.$sendReply !== null) {
      this.$sendReply.remove()
      this.$sendReply = null
    }
    this.replyComment = null
  }

  initSubmit () {
    this.$submitBtn.innerText = this.ctx.conf.sendBtn || 'Send'

    this.$submitBtn.addEventListener('click', (evt) => {
      const btnEl = evt.currentTarget
      this.submit()
    })
  }

  async submit () {
    if (this.getContent().trim() === '') {
      this.$textarea.focus()
      return
    }

    this.ctx.trigger('editor-submit')

    Ui.showLoading(this.$el)

    try {
      const nComment = await new Api(this.ctx).add({
        content: this.getContent(),
        nick: this.user.data.nick,
        email: this.user.data.email,
        link: this.user.data.link,
        rid: this.replyComment === null ? 0 : this.replyComment.id
      })

      this.ctx.trigger('list-insert', nComment)
      this.clearEditor() // 清空编辑器
      this.ctx.trigger('editor-submitted')
    } catch (err: any) {
      console.error(err)
      this.showNotify(`评论失败，${err.msg || String(err)}`, 'e')
    } finally {
      Ui.hideLoading(this.$el)
    }
  }

  showNotify (msg: string, type) {
    Ui.showNotify(this.$notifyWrap, msg, type)
  }

  /** 关闭评论 */
  close () {
    this.$closeComment.style.display = ''

    if (!this.user.data.isAdmin) {
      this.$textarea.style.display = 'none'
      this.closePlug()
      this.$bottom.style.display = 'none'
    } else {
      // 管理员一直打开评论
      this.$textarea.style.display = ''
      this.$bottom.style.display = ''
    }
  }

  /** 打开评论 */
  open () {
    this.$closeComment.style.display = 'none'
    this.$textarea.style.display = ''
    this.$bottom.style.display = ''
  }
}

