'use client'

import { Heart } from 'lucide-react'
import { useDonateFlow } from './_components/useDonateFlow'
import { ProgressBar } from './_components/ProgressBar'
import { AmountStep } from './_components/AmountStep'
import { PaymentStep } from './_components/PaymentStep'
import { ProofStep } from './_components/ProofStep'
import { DoneStep } from './_components/DoneStep'

// ── Component ──────────────────────────────────────────────────────────────
// Multi-step donation flow. All state, effects and API handlers live in
// useDonateFlow(); this component just wires them to the step views.
export default function DonatePage() {
  const f = useDonateFlow()
  const { lang, step, error } = f

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#C8102E] rounded-2xl mb-4">
            <Heart className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-[#0A2342]">
            {lang === 'zh' ? '支持岚山跑团' : 'Support Misty Mountain Runners'}
          </h1>
          <p className="text-gray-500 mt-2">
            {lang === 'zh'
              ? '您的捐赠帮助我们组织更多跑步活动和社区项目。'
              : 'Your donation helps us organize more runs and community programs.'}
          </p>
          <p className="text-xs text-gray-400 mt-1">501(c)(3) nonprofit</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <ProgressBar lang={lang} step={step} stepIndex={f.stepIndex} />

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {step === 'amount' && (
            <AmountStep
              lang={lang}
              amount={f.amount}
              setAmount={f.setAmount}
              customAmount={f.customAmount}
              setCustomAmount={f.setCustomAmount}
              payForm={f.payForm}
              setPayForm={f.setPayForm}
              donateAmount={f.donateAmount}
              nextStep={f.nextStep}
            />
          )}

          {step === 'payment' && (
            <PaymentStep
              lang={lang}
              donateAmount={f.donateAmount}
              payMethod={f.payMethod}
              setPayMethod={f.setPayMethod}
              memberId={f.memberId}
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
            <DoneStep lang={lang} eventId={f.eventId} />
          )}
        </div>
      </div>
    </main>
  )
}
