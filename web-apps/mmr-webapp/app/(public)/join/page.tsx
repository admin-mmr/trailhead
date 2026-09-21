'use client'

import { useJoinFlow } from './_components/useJoinFlow'
import { ProgressBar } from './_components/ProgressBar'
import { PlanStep } from './_components/PlanStep'
import { InfoStep } from './_components/InfoStep'
import { PaymentStep } from './_components/PaymentStep'
import { ProofStep } from './_components/ProofStep'
import { DoneStep } from './_components/DoneStep'

// ── Component ──────────────────────────────────────────────────────────────
// Multi-step join / renew flow. All state, effects and API handlers live in
// useJoinFlow(); this component just wires them to the step views.
export default function JoinPage() {
  const f = useJoinFlow()
  const { lang, step, existingMember, isRenewing, error } = f

  return (
    <main className="min-h-screen bg-gradient-to-b from-lantern-blush to-lantern-blush-2 py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          {/* Bilingual lockup, matching the home page: the Chinese title is
              always present rather than swapped out by the toggle. */}
          <h1 className="font-lantern text-3xl font-bold tracking-tight text-lantern-ink">
            {isRenewing
              ? (lang === 'zh' ? '续费会员' : 'Renew Your Membership')
              : (lang === 'zh' ? '加入岚山跑团' : 'Join Misty Mountain Runners')}
          </h1>
          <p className="mt-3 text-lantern-ink-soft">
            {lang === 'zh' ? '成为我们社区的一员' : 'Become part of our running community'}
          </p>
        </div>

        {/* Renewing-as banner */}
        {isRenewing && existingMember && (
          <div className="mb-6 p-4 bg-lantern-gold-tint border border-lantern-gold-foil/40 rounded-2xl flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-crimson flex items-center justify-center text-white font-bold flex-shrink-0">
              {([existingMember.firstName, existingMember.lastName].filter(Boolean).join(' ') || existingMember.email)[0].toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-lantern-ink">
                {lang === 'zh' ? '续费身份：' : 'Renewing as:'}{' '}
                {[existingMember.firstName, existingMember.lastName].filter(Boolean).join(' ') || existingMember.email}
              </p>
              <p className="text-xs text-lantern-ink-soft">
                {lang === 'zh' ? '会员编号：' : 'Member ID: '}{existingMember.memberId}
                {' · '}{existingMember.email}
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-[22px] border border-lantern-line p-6 sm:p-8 shadow-[0_18px_40px_-16px_rgba(140,14,32,0.16)]">
          <ProgressBar lang={lang} step={step} stepIndex={f.stepIndex} />

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {step === 'plan' && (
            <PlanStep lang={lang} plan={f.plan} setPlan={f.setPlan} nextStep={f.nextStep} />
          )}

          {step === 'info' && (
            <InfoStep
              lang={lang}
              isRenewing={isRenewing}
              info={f.info}
              fieldErrors={f.fieldErrors}
              submitting={f.submitting}
              onChange={f.handleInfoChange}
              onBlur={f.handleInfoBlur}
              onSubmit={f.handleInfoSubmit}
              prevStep={f.prevStep}
            />
          )}

          {step === 'payment' && (
            <PaymentStep
              lang={lang}
              currentPlan={f.currentPlan}
              payMethod={f.payMethod}
              setPayMethod={f.setPayMethod}
              memberId={f.memberId}
              info={f.info}
              payForm={f.payForm}
              setPayForm={f.setPayForm}
              stripeTestMode={f.stripeTestMode}
              zelleHandle={f.zelleHandle}
              venmoHandle={f.venmoHandle}
              submitting={f.submitting}
              onSubmit={f.handlePaymentSubmit}
              prevStep={f.prevStep}
            />
          )}

          {step === 'proof' && (
            <ProofStep
              lang={lang}
              eventId={f.eventId}
              proofFile={f.proofFile}
              setProofFile={f.setProofFile}
              fileRef={f.fileRef}
              submitting={f.submitting}
              onSubmit={f.handleProofUpload}
              onSkip={f.nextStep}
            />
          )}

          {step === 'done' && (
            <DoneStep lang={lang} memberId={f.memberId} eventId={f.eventId} />
          )}
        </div>
      </div>
    </main>
  )
}
