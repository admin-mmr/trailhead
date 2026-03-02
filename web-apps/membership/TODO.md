## bugs

- [ ] show sandglass icon waiting after returning user clicking "Continue"
- [ ] blank page. [MMR][renewal] goToStep2, method: Zelle type: Individual
- [ ] after clicking "Save Changes in profile, redirect to dashboard. now it stays in the profile page. 
- [ ] dashboard's Upgrade to Family Membership section, we actually ask users to change their membership type in the profile page. not about paying for the upgrade immediately.
- [ ] we have to remember an active member's type with confirmed payment. because a member can upgrade to family. 
- [ ] Update Profile doesn't have a membership type selection.
- [ ] payment options: Individual, Family, and Family Upgrade. 
- [ ] Admin Panel is not gated. anyone can access it by going to /admin. need to check if the user is in the admin email list.

## features

- [ ] add a page in member dashboard to let them upload their payment proof. We have a preset of events to confirm their payment. input fields include: amount, date, payer name, last 4 digits of confirmation code, payer notes, confirmation screenshot file upload (optional). make the events dropdown reads from a new Google Sheet Member-Portal file. Inside the sheet, we create a new tab called "Payment Confirmation Events". The columns include: Event Name, Description, and Confirmation Method. For example, for the event "Individual Membership" or "Family Membership", the description can be "Confirm your payment for membership renewal", and the confirmation method can be "Match with payment history". For the event "Upgrade to Family Membership", the description can be "Confirm your payment for upgrading to family membership", and the confirmation method can be "Match with payment history". no need for New Membership vs Renewal. The amount is the same. and the confirmation method can be "Match with payment history". For the event "Other Payment", the description can be "Confirm your other payments related to membership", and the confirmation method can be "Manual review".


- [ ] add a membership type selection in the profile page. and only show the payment options that are relevant to the user's current membership type.
- [ ] add a membership type selection in the renewal page. and only show the payment options that are relevant to the user's current membership type. for example, if the user is an individual member, we show the options for Individual and Family Upgrade. if the user is a family member, we only show the option for Family. 
- [ ] add a membership type column in the payment history sheet. and use it in the reconciliation process to improve the matching accuracy. 
- [ ] add


