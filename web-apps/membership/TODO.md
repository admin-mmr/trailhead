- [ ] in login phase, if we don't see any OTP code available and not expired for this email address, we automatically send them a new code and tell them to check their email.

- [ ] error in page=payment_history: Uncaught ReferenceError: SESSIONID is not defined
    at userCodeAppPanel?createOAuthDialog=true:133:74

- [ ] remove renewal page. 

add PaymentMethod in Submit Payment Proof page.

dashboard actions depending on the membership type and membership expires and webapp-events history.

1. if any status=Pending, button=View Pending Requests.
2. if membership expires < 42 days, button=Pay Dues, PaymentIntent depends on Membership Type. 
3. if membership expires < 42 days and Type = Individual, button= Switch to Family, send PaymentIntent = Family Membership
4. if membership expires >= 42 days and Type = Individual, button=Upgrade to Family, send PaymentIntent = Family Upgrade 



- [ ] Timestamp of all rows in WebApp-Events table is updated to the current time. It should be the event original time. 

- [ ] Membership Type if shown Individual, display a button right next to it to "Upgrade to Family". Clicking the button will mark this user's attempt to change to Family membership. 
    1. If the current membership is good for more than 2 months, we route to page=payment, type=upgrade to family, amount=20. 
    2. if the current membership is about to expire or has expired, we route to page=payment, type=family renewal, amount=50

looks like our member's state machine is more complicated than we thought. we have to consider both the current membership type and the expiration date to determine what payment options we should show to users.

show the payment options for family membership. If the user successfully pays for the upgrade, we update their membership type to family in the profile page.

- [ ] Renew Membership page shows incorrect options for individual members whose membership about to expire. Let's remove the renewal page all together. Since we renew for the new year, we show Renew Individual and Change to Family. 
    - for family members whose membership about to expire, we show Renew Family and Change to Individual.
    - for expired members or new members, we show Pay Individual and Pay Family options. 
    - for individual members whose membership expires more than 6 weeks later, we show Extend Individual and Change to Family options.
    for individual members whose membership expires more than 6 weeks later, we show Extend Individual and Change to Family options.

how do we determine what status a member is in? 
1. Individual membership expires more than 6 weeks later. 
2. Individual membership expiring soon. 

- [ ] after clicking "Save Changes" in profile, the button display "Saving... and greyed out". when save operation is done, the top of page shows "Profile updated successfully! Redirecting…". It doesn't redirect to dashboard. the current design is hard to see the success message or error message because it doesn't automatically scroll to the top of page. therefore 3 issues after clicking "Save Changes":
    1. if the update is successful, users might not see the success message and think nothing happened.
    2. if the update fails, users might not see the error message and think their changes are saved successfully.
    3. redirect to dashboard after successful update, so users can see the updated membership type and relevant payment options immediately.

- [ ] dashboard's Upgrade to Family Membership section, we actually ask users to change their membership type in the profile page. not about paying for the upgrade immediately.
- [ ] we have to remember an active member's type with confirmed payment. because a member can upgrade to family.
- [ ] Update Profile doesn't have a membership type selection.

## features

- [ ] remove the last section "Upgrade to Family Membership" more compact dashboard. "Is your family information correct?" if the user is confirmed family member or has requested family membership. in dashboard we display a family member table and a button "Edit Family Profile ->" which will take users to the profile page where they can edit family member information.



- [ ] add a membership type column in the payment history sheet. and use it in the reconciliation process to improve the matching accuracy.
