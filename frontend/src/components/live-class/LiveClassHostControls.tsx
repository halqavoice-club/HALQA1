'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { getAvatarUrl } from '@/lib/avatar'
import { GiftEarningsWidget } from './GiftEarningsWidget'
import {
  Mic, MicOff, Video, VideoOff, UserX, ChevronDown,
  ChevronUp, Radio, PenLine, BookOpen, MessageSquare,
  Hand, HandMetal, Settings, Users,
  Volume2, VolumeX, Crown,
  Shield, Slash, Monitor, Pencil,
} from 'lucide-react'
// ─── Types ────────────────────────────────────────────────────────────────────
export interface LCParticipant {
  id: string; userId: string; role: 'HOST' | 'MODERATOR' | 'STUDENT' | 'OBSERVER'
  isMuted: boolean; isVideoOn: boolean; handRaised: boolean
  // MIC-02: speakerSlot is non-null when this participant is an active speaker on stage.
  // null = audience (subscribe-only). Mirrors the DB column.
  speakerSlot?: number | null
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

export interface ClassSettings {
  chatEnabled:          boolean
  handRaiseEnabled:     boolean
  quranPanelEnabled:    boolean
  whiteboardEnabled:    boolean
  isOpenMic:            boolean
  isRecording:          boolean
  screenShareEnabled:   boolean   // host can allow/restrict screen sharing by participants
  viewMode:             'video' | 'audio'  // host can switch all participants to audio-only
  maxSpeakers:          number    // max simultaneous active speakers on stage
}

export interface HostControlsProps {
  liveClassId:        string
  status:             'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  participants:       LCParticipant[]
  settings:           ClassSettings
  activeSpeakers:     Set<string>
  currentUserId:      string | undefined
  activePanel:        'whiteboard' | null
  // Actions
  onStart?:           () => void
  onEnd?:             () => void
  onMuteAll:          () => void
  onUnmuteAll:        () => void
  onLowerAllHands:    () => void
  onMute:             (userId: string, muted: boolean) => void
  onKick:             (userId: string) => void
  onDemote:           (userId: string) => void
  onInviteToStage:    (userId: string) => void
  onApproveHand:      (userId: string) => void
  onRejectHand:       (userId: string) => void
  onToggleOpenMic:    () => void
  onToggleRecording:  () => void
  onToggleWhiteboard: () => void
  onToggleSetting:    (key: keyof Pick<ClassSettings, 'chatEnabled' | 'handRaiseEnabled' | 'quranPanelEnabled' | 'whiteboardEnabled' | 'screenShareEnabled'>) => void
  onSetViewMode:      (mode: 'video' | 'audio') => void
  onSetMaxSpeakers:   (n: number) => void
  onEdit?:            () => void
  // Moderator management — only HOST can do these
  onPromoteModerator?: (userId: string) => void
  onDemoteModerator?:  (userId: string) => void
  // Host transfer — LS-GAP-003 fix
  onTransferHost?:     (userId: string) => void
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({
  title, icon, badge, defaultOpen = true, children,
}: {
  title: string; icon: React.ReactNode; badge?: React.ReactNode
  defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-800/80 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-900/60 hover:bg-gray-800/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400">{icon}</span>
          <span className="text-xs font-bold text-gray-300">{title}</span>
          {badge}
        </div>
        {open
          ? <ChevronUp   className="w-3.5 h-3.5 text-gray-500" />
          : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
        }
      </button>
      {open && <div className="p-3 space-y-2 bg-gray-950/40">{children}</div>}
    </div>
  )
}

// ─── Toggle row ───────────────────────────────────────────────────────────────
function ToggleRow({
  icon, label, description, enabled, onToggle, colorOn = 'text-green-400', disabled = false,
}: {
  icon: React.ReactNode; label: string; description?: string
  enabled: boolean; onToggle: () => void; colorOn?: string; disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn('flex-shrink-0', enabled ? colorOn : 'text-gray-600')}>{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-300 truncate">{label}</p>
          {description && <p className="text-[10px] text-gray-600 truncate">{description}</p>}
        </div>
      </div>
      <button
        onClick={onToggle}
        disabled={disabled}
        className={cn(
          'relative w-9 h-5 rounded-full transition-colors flex-shrink-0 disabled:opacity-40',
          enabled ? 'bg-indigo-600' : 'bg-gray-700'
        )}
      >
        <span className={cn(
          'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
          enabled ? 'left-[18px]' : 'left-0.5'
        )} />
      </button>
    </div>
  )
}

// ─── Participant row ──────────────────────────────────────────────────────────
function ParticipantRow({
  p, isSpeaking, isCurrentUser, isHost,
  onMute, onKick, onDemote, onInviteToStage, onApproveHand, onRejectHand,
  onPromoteModerator, onDemoteModerator, onTransferHost,
}: {
  p: LCParticipant; isSpeaking: boolean; isCurrentUser: boolean
  isHost: boolean  // true = caller is HOST (can promote/demote mod); false = MODERATOR
  onMute:              (muted: boolean) => void
  onKick:              () => void
  onDemote:            () => void
  onInviteToStage:     () => void
  onApproveHand:       () => void
  onRejectHand:        () => void
  onPromoteModerator:  () => void
  onDemoteModerator:   () => void
  onTransferHost?:     () => void
}) {
  const [showActions, setShowActions] = useState(false)
  const avatarSrc = getAvatarUrl(p.user.avatarUrl)
  const initials  = (p.user.firstName[0] + p.user.lastName[0]).toUpperCase()

  return (
    <div className="rounded-xl bg-gray-900/50 border border-gray-800/50 overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-2 p-2">
        {/* Avatar */}
        <div className={cn(
          'relative w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-indigo-900 flex items-center justify-center text-xs font-bold text-indigo-300',
          isSpeaking && 'ring-2 ring-green-400 ring-offset-1 ring-offset-gray-900'
        )}>
          {avatarSrc
            ? <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
            : initials}
          {isSpeaking && (
            <span className="absolute inset-0 rounded-full border-2 border-green-400 animate-ping opacity-30" />
          )}
        </div>

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-xs font-medium text-gray-200 truncate">
              {p.user.firstName} {p.user.lastName}
              {isCurrentUser && <span className="text-gray-500"> (You)</span>}
            </p>
            {p.role === 'HOST' && (
              <Crown className="w-3 h-3 text-yellow-400 flex-shrink-0" />
            )}
            {p.role === 'MODERATOR' && (
              <span className="text-[9px] text-blue-400 font-bold ml-0.5">MOD</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {p.handRaised && (
              <span className="text-[10px] text-yellow-400 bg-yellow-900/30 px-1 rounded font-bold">✋ Raised</span>
            )}
            {p.speakerSlot != null && (
              <span className="text-[10px] text-indigo-400 bg-indigo-900/30 px-1 rounded font-bold">🎙 On Stage</span>
            )}
            {isSpeaking && (
              <span className="text-[10px] text-green-400 flex items-center gap-0.5">
                <span className="w-1 h-1 bg-green-400 rounded-full animate-pulse" /> Speaking
              </span>
            )}
            {!p.isMuted && !isSpeaking && (
              <span className="text-[10px] text-gray-500">Unmuted</span>
            )}
            {p.isMuted && (
              <span className="text-[10px] text-red-400/70">Muted</span>
            )}
          </div>
        </div>

        {/* Quick action icons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isCurrentUser && p.role !== 'HOST' && (
            <>
              {/* Mute toggle */}
              <button
                onClick={() => onMute(!p.isMuted)}
                title={p.isMuted ? 'Unmute' : 'Mute'}
                className={cn(
                  'w-6 h-6 rounded-md flex items-center justify-center transition-colors',
                  p.isMuted
                    ? 'text-red-400 hover:bg-red-900/30'
                    : 'text-green-400 hover:bg-green-900/30'
                )}
              >
                {p.isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>

              {/* Expand actions */}
              <button
                onClick={() => setShowActions(v => !v)}
                className="w-6 h-6 rounded-md flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors"
              >
                {showActions
                  ? <ChevronUp   className="w-3.5 h-3.5" />
                  : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded actions */}
      {showActions && !isCurrentUser && p.role !== 'HOST' && (
        <div className="px-2 pb-2 flex flex-wrap gap-1.5 border-t border-gray-800/50 pt-2">
          {p.handRaised && (
            <>
              <button
                onClick={() => { onApproveHand(); setShowActions(false) }}
                className="flex items-center gap-1 text-[10px] text-green-400 hover:text-green-300 bg-green-900/20 hover:bg-green-900/40 border border-green-800/40 px-2 py-1 rounded-lg transition-colors"
              >
                <Mic className="w-3 h-3" /> Allow to speak
              </button>
              <button
                onClick={() => { onRejectHand(); setShowActions(false) }}
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-2 py-1 rounded-lg transition-colors"
              >
                <HandMetal className="w-3 h-3" /> Lower hand
              </button>
            </>
          )}
          {!p.handRaised && (
            <button
              onClick={() => { onMute(!p.isMuted); setShowActions(false) }}
              className={cn(
                'flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-colors',
                p.isMuted
                  ? 'text-green-400 hover:text-green-300 bg-green-900/20 hover:bg-green-900/40 border-green-800/40'
                  : 'text-yellow-400 hover:text-yellow-300 bg-yellow-900/20 hover:bg-yellow-900/40 border-yellow-800/40'
              )}
            >
              {p.isMuted ? <><Mic className="w-3 h-3" /> Unmute</> : <><MicOff className="w-3 h-3" /> Mute</>}
            </button>
          )}
          <button
            onClick={() => { onKick(); setShowActions(false) }}
            className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/40 border border-red-800/40 px-2 py-1 rounded-lg transition-colors"
          >
            <UserX className="w-3 h-3" /> Remove
          </button>
          {/* MIC-02: Demote active speaker back to audience */}
          {p.speakerSlot != null && (
            <button
              onClick={() => { onDemote(); setShowActions(false) }}
              className="flex items-center gap-1 text-[10px] text-orange-400 hover:text-orange-300 bg-orange-900/20 hover:bg-orange-900/40 border border-orange-800/40 px-2 py-1 rounded-lg transition-colors"
            >
              <MicOff className="w-3 h-3" /> Demote from stage
            </button>
          )}
          {/* Invite audience member directly to stage (no hand raise needed) */}
          {p.speakerSlot == null && !p.handRaised && (
            <button
              onClick={() => { onInviteToStage(); setShowActions(false) }}
              className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 bg-indigo-900/20 hover:bg-indigo-900/40 border border-indigo-800/40 px-2 py-1 rounded-lg transition-colors"
            >
              <Mic className="w-3 h-3" /> Invite to stage
            </button>
          )}
          {/* Promote/demote moderator — HOST only */}
          {isHost && p.role !== 'MODERATOR' && (
            <button
              onClick={() => { onPromoteModerator(); setShowActions(false) }}
              className="flex items-center gap-1 text-[10px] text-yellow-400 hover:text-yellow-300 bg-yellow-900/20 hover:bg-yellow-900/40 border border-yellow-800/40 px-2 py-1 rounded-lg transition-colors"
            >
              <Crown className="w-3 h-3" /> Make moderator
            </button>
          )}
          {isHost && p.role === 'MODERATOR' && (
            <button
              onClick={() => { onDemoteModerator(); setShowActions(false) }}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-2 py-1 rounded-lg transition-colors"
            >
              <Shield className="w-3 h-3" /> Remove moderator
            </button>
          )}
          {/* Transfer host — HOST only; outer block already excludes HOST participants */}
          {isHost && onTransferHost && (
            <button
              onClick={() => { onTransferHost(); setShowActions(false) }}
              className="flex items-center gap-1 text-[10px] text-yellow-300 hover:text-yellow-200 bg-yellow-900/20 hover:bg-yellow-900/40 border border-yellow-700/40 px-2 py-1 rounded-lg transition-colors"
            >
              <Crown className="w-3 h-3" /> Make host
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function LiveClassHostControls({
  liveClassId, status, participants, settings, activeSpeakers,
  currentUserId, activePanel,
  onStart, onEnd, onMuteAll, onUnmuteAll, onLowerAllHands,
  onMute, onKick, onDemote, onInviteToStage,
  onApproveHand, onRejectHand,
  onToggleOpenMic, onToggleRecording, onToggleWhiteboard,
  onToggleSetting, onSetViewMode, onSetMaxSpeakers, onEdit,
  onPromoteModerator, onDemoteModerator, onTransferHost,
}: HostControlsProps) {
  const students       = participants.filter(p => p.role !== 'HOST')
  const raisedHands    = participants.filter(p => p.handRaised)
  const mutedCount     = students.filter(p => p.isMuted).length
  const unmutedCount   = students.filter(p => !p.isMuted).length
  // MIC-02: active speakers = non-HOST participants with a speakerSlot assigned
  const activeSpeakerCount = participants.filter(p => p.role !== 'HOST' && p.speakerSlot != null).length

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-3 space-y-3">

        {/* ── Class lifecycle ───────────────────────────────────────────── */}
        <Section
          title="Class Control"
          icon={<Settings className="w-3.5 h-3.5" />}
        >
          {/* Edit title / cover */}
          {onEdit && status !== 'ENDED' && status !== 'CANCELLED' && (
            <button
              onClick={onEdit}
              className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit Title &amp; Cover
            </button>
          )}
          {onStart && status === 'SCHEDULED' && (
            <button
              onClick={onStart}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors"
            >
              <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
              Start Class Now
            </button>
          )}

          {status === 'LIVE' && (
            <div className="space-y-2">
              {/* Recording */}
              <ToggleRow
                icon={<span className={cn('w-3 h-3 rounded-full', settings.isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-600')} />}
                label={settings.isRecording ? 'Recording… (tap to stop)' : 'Record class'}
                description={settings.isRecording ? 'Class is being recorded' : 'Save this session'}
                enabled={settings.isRecording}
                onToggle={onToggleRecording}
                colorOn="text-red-400"
              />

              {/* End class — creator only */}
              {onEnd && (
                <button
                  onClick={onEnd}
                  className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-red-900/40 border border-gray-700 hover:border-red-700/50 text-red-400 hover:text-red-300 text-xs font-semibold px-4 py-2 rounded-xl transition-colors"
                >
                  <Slash className="w-3.5 h-3.5" />
                  End Class
                </button>
              )}
            </div>
          )}

          {(status === 'ENDED' || status === 'CANCELLED') && (
            <p className="text-center text-xs text-gray-600 py-2">Class has ended</p>
          )}
        </Section>

        {/* ── HOST MANAGEMENT (Google Meet style) ────────────────────────── */}
        {status === 'LIVE' && (
          <Section
            title="Host Management"
            icon={<Crown className="w-3.5 h-3.5" />}
          >
            {/* Header description */}
            <p className="text-[10px] text-gray-500 pb-1">
              Restrict what participants can do in the meeting.
            </p>

            {/* View mode toggle — Video ↔ Audio only */}
            <div className="rounded-xl bg-gray-900/50 border border-gray-800/50 p-2.5 space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">View Mode</p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => onSetViewMode('video')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors border',
                    settings.viewMode === 'video'
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white hover:bg-gray-700'
                  )}
                >
                  <Video className="w-3.5 h-3.5" /> Video
                </button>
                <button
                  onClick={() => onSetViewMode('audio')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors border',
                    settings.viewMode === 'audio'
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white hover:bg-gray-700'
                  )}
                >
                  <Users className="w-3.5 h-3.5" /> Audio only
                </button>
              </div>
              <p className="text-[10px] text-gray-600">
                {settings.viewMode === 'audio'
                  ? 'All participants see avatar circles — cameras hidden'
                  : 'All participants see camera tiles'}
              </p>
            </div>

            {/* Let everyone section */}
            <div className="rounded-xl bg-gray-900/50 border border-gray-800/50 p-2.5 space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Let everyone</p>

              <ToggleRow
                icon={<Monitor className="w-3.5 h-3.5" />}
                label="Share their screen"
                description={settings.screenShareEnabled ? 'Anyone can share screen' : 'Only host can share'}
                enabled={settings.screenShareEnabled}
                onToggle={() => onToggleSetting('screenShareEnabled')}
                colorOn="text-blue-400"
              />

              <div className="border-t border-gray-800/50 pt-2">
                <ToggleRow
                  icon={<MessageSquare className="w-3.5 h-3.5" />}
                  label="Send chat"
                  description={settings.chatEnabled ? 'Participants can chat' : 'Chat is disabled'}
                  enabled={settings.chatEnabled}
                  onToggle={() => onToggleSetting('chatEnabled')}
                  colorOn="text-green-400"
                />
              </div>
            </div>
          </Section>
        )}

        {/* ── Broadcast settings ─────────────────────────────────────────── */}
        {status === 'LIVE' && (
          <Section
            title="Broadcast"
            icon={<Radio className="w-3.5 h-3.5" />}
          >
            <ToggleRow
              icon={<Radio className="w-3.5 h-3.5" />}
              label="Open Mic"
              description="All students can speak freely"
              enabled={settings.isOpenMic}
              onToggle={onToggleOpenMic}
              colorOn="text-green-400"
            />
            <ToggleRow
              icon={<PenLine className="w-3.5 h-3.5" />}
              label="Whiteboard"
              description={activePanel === 'whiteboard' ? 'Active — students can see' : 'Off'}
              enabled={activePanel === 'whiteboard'}
              onToggle={onToggleWhiteboard}
            />

            {/* Max speakers on stage */}
            <div className="rounded-xl bg-gray-900/50 border border-gray-800/50 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Max Speakers on Stage</p>
                <span className="text-xs font-bold text-indigo-400">{settings.maxSpeakers}</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {[2, 4, 6, 8, 10, 20].map(n => (
                  <button
                    key={n}
                    onClick={() => onSetMaxSpeakers(n)}
                    className={cn(
                      'flex-1 min-w-[32px] py-1.5 rounded-lg text-xs font-bold border transition-colors',
                      settings.maxSpeakers === n
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white hover:bg-gray-700'
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-600">
                {activeSpeakerCount} / {settings.maxSpeakers} stage slots in use
              </p>
            </div>
          </Section>
        )}

        {/* ── Gift Earnings (HOST only) ───────────────────────────────────── */}
        {status === 'LIVE' && (
          <Section
            title="Gifts"
            icon={<span className="text-yellow-400">🎁</span>}
            defaultOpen={false}
          >
            <GiftEarningsWidget liveClassId={liveClassId} />
          </Section>
        )}

        {/* ── Class settings ─────────────────────────────────────────────── */}
        <Section
          title="Class Settings"
          icon={<Shield className="w-3.5 h-3.5" />}
          defaultOpen={false}
        >
          <ToggleRow
            icon={<Hand className="w-3.5 h-3.5" />}
            label="Hand Raise"
            description="Students can raise their hand"
            enabled={settings.handRaiseEnabled}
            onToggle={() => onToggleSetting('handRaiseEnabled')}
          />
          <ToggleRow
            icon={<BookOpen className="w-3.5 h-3.5" />}
            label="Quran Panel"
            description="Show Quran viewer in class"
            enabled={settings.quranPanelEnabled}
            onToggle={() => onToggleSetting('quranPanelEnabled')}
            colorOn="text-emerald-400"
          />
          <ToggleRow
            icon={<PenLine className="w-3.5 h-3.5" />}
            label="Whiteboard"
            description="Enable drawing board"
            enabled={settings.whiteboardEnabled}
            onToggle={() => onToggleSetting('whiteboardEnabled')}
          />
        </Section>

        {/* ── Hand raise queue ───────────────────────────────────────────── */}
        <Section
          title="Hand Queue"
          icon={<Hand className="w-3.5 h-3.5" />}
          badge={
            raisedHands.length > 0
              ? <span className="ml-1 text-[10px] font-bold bg-yellow-500 text-yellow-950 px-1.5 py-0.5 rounded-full">{raisedHands.length}</span>
              : undefined
          }
        >
          {raisedHands.length === 0 ? (
            <p className="text-[11px] text-gray-600 text-center py-1">No hands raised</p>
          ) : (
            <div className="space-y-1.5">
              {/* Bulk action: lower all hands */}
              <button
                onClick={onLowerAllHands}
                className="w-full flex items-center justify-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-1.5 rounded-lg transition-colors font-medium mb-1"
              >
                <HandMetal className="w-3 h-3" /> Lower All Hands
              </button>
              {raisedHands.map((p, i) => (
                <div key={p.userId} className="flex items-center gap-2 bg-yellow-900/20 border border-yellow-800/30 rounded-xl px-3 py-2">
                  <span className="text-[10px] text-yellow-600 w-4 flex-shrink-0">{i + 1}.</span>
                  <div className="w-6 h-6 rounded-full overflow-hidden bg-indigo-900 flex items-center justify-center text-[10px] font-bold text-indigo-300 flex-shrink-0">
                    {getAvatarUrl(p.user.avatarUrl)
                      ? <img src={getAvatarUrl(p.user.avatarUrl)!} alt="" className="w-full h-full object-cover" />
                      : p.user.firstName[0] + p.user.lastName[0]}
                  </div>
                  <span className="text-xs text-gray-300 flex-1 truncate">{p.user.firstName} {p.user.lastName}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onApproveHand(p.userId)}
                      title="Allow to speak"
                      className="flex items-center gap-0.5 text-[10px] text-green-400 hover:text-green-300 bg-green-900/30 hover:bg-green-900/50 px-2 py-0.5 rounded-lg transition-colors font-bold"
                    >
                      <Mic className="w-3 h-3" /> Allow
                    </button>
                    <button
                      onClick={() => onRejectHand(p.userId)}
                      title="Lower hand"
                      className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-gray-700 rounded-md transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Participant management ──────────────────────────────────────── */}
        <Section
          title={`Participants (${participants.length})`}
          icon={<Users className="w-3.5 h-3.5" />}
          badge={
            unmutedCount > 0
              ? <span className="ml-1 text-[10px] text-green-400">{unmutedCount} live</span>
              : undefined
          }
          defaultOpen={false}
        >
          {/* Bulk actions */}
          {students.length > 0 && (
            <div className="flex gap-2 pb-2 border-b border-gray-800/50">
              <button
                onClick={onMuteAll}
                className="flex-1 flex items-center justify-center gap-1.5 text-[11px] text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-1.5 rounded-lg transition-colors font-medium"
              >
                <VolumeX className="w-3 h-3" /> Mute All
              </button>
              <button
                onClick={onUnmuteAll}
                className="flex-1 flex items-center justify-center gap-1.5 text-[11px] text-green-400 hover:text-green-300 bg-gray-800 hover:bg-green-900/20 border border-gray-700 hover:border-green-700/50 px-3 py-1.5 rounded-lg transition-colors font-medium"
              >
                <Volume2 className="w-3 h-3" /> Unmute All
              </button>
            </div>
          )}

          {/* Participant list */}
          <div className="space-y-1.5">
            {participants.map(p => (
              <ParticipantRow
                key={p.userId}
                p={p}
                isSpeaking={activeSpeakers.has(p.userId)}
                isCurrentUser={p.userId === currentUserId}
                isHost={!!onPromoteModerator}
                onMute={(muted) => onMute(p.userId, muted)}
                onKick={() => onKick(p.userId)}
                onDemote={() => onDemote(p.userId)}
                onInviteToStage={() => onInviteToStage(p.userId)}
                onApproveHand={() => onApproveHand(p.userId)}
                onRejectHand={() => onRejectHand(p.userId)}
                onPromoteModerator={() => onPromoteModerator?.(p.userId)}
                onDemoteModerator={() => onDemoteModerator?.(p.userId)}
                onTransferHost={onTransferHost ? () => onTransferHost(p.userId) : undefined}
              />
            ))}
          </div>

          {participants.length === 0 && (
            <p className="text-[11px] text-gray-600 text-center py-2">No participants yet</p>
          )}
        </Section>

        {/* ── Stats ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Total',    value: participants.length, color: 'text-gray-300' },
            { label: 'On Stage', value: activeSpeakerCount,  color: 'text-indigo-400' },
            { label: 'Live mic', value: unmutedCount,        color: 'text-green-400' },
            { label: 'Muted',    value: mutedCount,          color: 'text-red-400'   },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-gray-900/60 border border-gray-800/50 rounded-xl px-2 py-2 text-center">
              <p className={cn('text-base font-bold', color)}>{value}</p>
              <p className="text-[10px] text-gray-600">{label}</p>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
