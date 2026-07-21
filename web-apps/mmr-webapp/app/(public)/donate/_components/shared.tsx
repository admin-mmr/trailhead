import { Heart, CheckCircle, Upload, CreditCard } from 'lucide-react'

export type Step = 'amount' | 'payment' | 'proof' | 'done'
export type PayMethod = 'card' | 'zelle' | 'venmo'

export interface DonateForm {
  payerName: string
  paymentDate: string
  memoField: string
  last4: string
  firstName: string
  lastName: string
  email: string
  phone: string
}

export const STEP_ORDER: Step[] = ['amount', 'payment', 'proof', 'done']

export const SUGGESTED_AMOUNTS = [10, 25, 50, 100]

export const STEPS: { id: Step; label: string; labelZh: string; icon: React.ReactNode }[] = [
  { id: 'amount',  label: 'Amount', labelZh: '金额', icon: <Heart className="w-4 h-4" /> },
  { id: 'payment', label: 'Pay',    labelZh: '付款', icon: <CreditCard className="w-4 h-4" /> },
  { id: 'proof',   label: 'Proof',  labelZh: '凭证', icon: <Upload className="w-4 h-4" /> },
  { id: 'done',    label: 'Done',   labelZh: '完成', icon: <CheckCircle className="w-4 h-4" /> },
]
