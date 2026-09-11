# Roundhouse Reward Center Screens

## Purpose

The Reward Center is opened by tapping the user's **Status / Points** area on the Command Center.

For MVP, the Reward Center is primarily a **visual accounting, recognition, and future-capability screen**. It lets testers see that useful participation earns points, that points accumulate, and that accumulated points elevate status. It should feel richer, more colorful, and more game-like than the rest of Roundhouse while remaining clearly part of Roundhouse.

The MVP does **not** need a complete reward economy, redemption marketplace, sponsor fulfillment system, or functioning in-house reward engine.

**MVP loop:**

**Useful action → Points increase → Visible recognition → Progress bar advances → Status rises**

Examples of immediate feedback may include `+25`, a rolling point total, and a status notification such as **You earned Wood Status**.

The Reward Center should visually communicate what those points and statuses may unlock in the future without requiring those future rewards to function during MVP.

---

# Shared Screen Architecture

All four Reward Center variants use the same basic top structure.

## 1. Top Navigation

- Strong **Back to Command Center** control at upper-left.
- **Reward Center** title.
- Role/context may appear beneath the title where useful.

The Command Center remains the landing page.

## 2. Status + Points Hero

This is the largest and most visually dominant section.

It shows:

- Current Status prominently, for example **WOOD**.
- Current point total prominently, for example **1,240 pts**.
- A large horizontal progress/bus bar showing how far the person is from the next Status.
- Next Status and required point threshold.
- Clear language such as **260 points to Iron**.

The relationship must be visually obvious:

**The number count increases the user's Points. Increasing Points moves the progress bar. Reaching the threshold elevates the user's Status.**

Status is therefore not a separate score. It is the visible level produced by accumulated Roundhouse Points.

The exact final Status names and thresholds remain configurable and should not block MVP.

## 3. Badges

Badges sit directly below the Status + Points hero so testers immediately see another layer of future gamification.

Badges should be colorful, collectible-looking visual objects rather than plain text rows. Earned badges appear active and colorful. Future or unearned badges may remain visible in a subdued/locked state.

Initial visual examples:

- ⭐ **Early Sign-On Superstar**
- 🔥 **Sign-On Streak** — may display a streak number such as `7`, `14`, or `30`
- 📣 **Sharing Superstar**
- 🚀 **60% to Active User**
- 🦸 **Status Hero**
- 💯 **Profile 100% Complete**

Only a limited number of badges need functioning MVP logic. Others may demonstrate where the system is going.

## 4. Personal Activity / Points Accounting

A compact visual area shows why the user's score is changing.

Examples:

- `+25` Completed useful work
- `+10` Shared Roundhouse
- `+10` Daily sign-on
- `+25` Updated Profile
- other approved MVP point events

This is not intended to become a complex accounting ledger during MVP. Its purpose is to let testers understand **I did something → Roundhouse recognized it → my score increased**.

A lightweight **Your Activity / Strengths** visual report may also appear here. It can show illustrative categories such as work activity, completion, sharing, Profile completion, or engagement. Advanced reporting does not need to function in MVP.

## 5. Tips to Earn More

A visible **Tips to Earn More** card/button shows examples of actions that can increase Points.

Examples include:

- Complete your Profile
- Share Roundhouse
- Log legitimate work or participation
- Complete useful Roundhouse actions appropriate to the person's Role

This may be largely visual during MVP.

## 6. Coming Soon — Future Rewards

A clearly separate section appears **under the functioning Points / Status / Badges / activity experience**.

It must be visibly labeled **Coming Soon** so testers understand that these are examples of what their accumulated participation may eventually unlock rather than guaranteed MVP prizes.

Possible future rewards include:

- Roundhouse rewards
- Sponsored tools or equipment
- Milwaukee-style sponsored hand tools or similar manufacturer rewards
- Home and gardening products
- Discounts on services
- Advertising benefits
- Brand deals and partnerships
- other sponsored or partner benefits

A future service discount may create value on both sides: the Homeowner receives a benefit while a participating Trade Professional gains an opportunity to reach a new potential client. This is effectively a reward to the user wrapped around a customer-acquisition offer from the Trade Professional.

The MVP should **show the possibility without implementing the full redemption or monetary-value system**.

---

# Screen 1 — Trade Professional Owner / Manager Reward Center

This is the full Trade version.

## Top

Uses the shared Status + Points hero:

**Current Status → Current Points → Progress Bar → Next Status**

Badges, personal activity, recent Points, strengths/activity visualization, and Tips to Earn More follow beneath it.

## Trade Future Rewards — Coming Soon

Trade-oriented future reward cards may include:

- Sponsored Tools / Tool Giveaways
- Advertising Boosts
- Brand Deals & Partnerships
- Find-a-Pro visibility or other promotional benefits
- Roundhouse rewards

These are visual future capabilities for MVP unless specifically activated later.

## Team Rewards

Owner/Manager may see a **Team Rewards** card showing that they will eventually be able to view rewards and recognition associated with their Trade Team Members.

For MVP, this can be largely visual and marked **Coming Soon**. It should not require building a live team reward tally or management dashboard.

## In-House Rewards Creation Center — Coming Soon

This must be a separate, clearly named destination/card:

### In-House Rewards Creation Center

**Create incentives and rewards for your team. You or your organization are responsible for providing and fulfilling any rewards you create for Trade Team Members.**

The card is visible during MVP but does not need to open.

Roundhouse provides the future system for creating/tracking these incentives. The Business/Owner/Manager creating the reward is responsible for supplying and fulfilling it. These are distinct from rewards supplied by Roundhouse or outside sponsors.

---

# Screen 2 — Homeowner Owner / Manager Reward Center

This is the full Home version and follows nearly the same layout and behavior as the Trade Owner/Manager screen.

## Top

Uses the same shared progression:

**Current Status → Current Points → Progress Bar → Next Status**

The Homeowner sees their own personal Points, Status, Badges, activity/accounting, and Tips to Earn More.

Homeowner point-earning behaviors can emphasize engagement with the home record, useful participation, Profile completion, sharing Roundhouse, and helping bring appropriate participants into the platform.

## Home Future Rewards — Coming Soon

Home-oriented visual reward examples may include:

- Sponsored home products
- Gardening tools
- Home maintenance products
- Roundhouse rewards
- Discounts on participating Trade Professional services
- other future partner benefits

These demonstrate what Points may eventually unlock without requiring redemption functionality in MVP.

## Home Team Rewards

Owner/Manager may see a **Team Rewards** card indicating that they will eventually be able to see rewards and recognition for Home Team Members.

For MVP, this may be visual and **Coming Soon**.

## In-House Rewards Creation Center — Coming Soon

### In-House Rewards Creation Center

**Create incentives and rewards for your team. You are responsible for providing and fulfilling any rewards you create for Home Team Members.**

This is visible but does not need to open during MVP.

---

# Screen 3 — Trade Team Member Reward Center

This is a scaled-back individual version.

A Trade Team Member sees only their own reward experience. They do not see other team members' reward information and do not receive reward-creation or team-management controls.

## Top

Same visual progression:

**Current Status → Current Points → Progress Bar → Next Status**

Then:

- Personal Badges
- Personal activity / recent Points
- Personal strengths/activity visual
- Tips to Earn More

## Rewards — Coming Soon

The Trade Team Member may see future rewards offered by Roundhouse and a clearly separated company-funded area such as:

### Rewards Offered by DMT DESIGN BUILD

This tells the Team Member that their Business may eventually create and supply incentives specifically for its team.

The Team Member can see these rewards but cannot create, administer, or inspect another person's rewards.

---

# Screen 4 — Home Team Member Reward Center

This is the Home equivalent of the Trade Team Member screen.

The Home Team Member sees only their own Points, Status, progress, Badges, activity, and available/future rewards.

## Top

Same visual progression:

**Current Status → Current Points → Progress Bar → Next Status**

Then:

- Personal Badges
- Personal activity / recent Points
- Personal strengths/activity visual
- Tips to Earn More

## Rewards — Coming Soon

The Home Team Member may see:

- Future rewards offered by Roundhouse
- Future rewards supplied by the Homeowner/Property authority

The second area should be clearly labeled to identify its source, for example:

### Rewards Offered by [Home / Property / Homeowner]

The Home Team Member cannot create rewards and cannot see another team member's personal reward information.

---

# Key Differences Between the Four Screens

| Capability | Trade Owner / Manager | Homeowner Owner / Manager | Trade Team Member | Home Team Member |
| --- | --- | --- | --- | --- |
| Own Points + Status | Yes | Yes | Yes | Yes |
| Progress to Next Status | Yes | Yes | Yes | Yes |
| Personal Badges | Yes | Yes | Yes | Yes |
| Personal Activity / Point Accounting | Yes | Yes | Yes | Yes |
| Tips to Earn More | Yes | Yes | Yes | Yes |
| Roundhouse Future Rewards | Yes | Yes | Yes | Yes |
| Trade Advertising / Brand Deal Teasers | Yes | No | No | No |
| Home Product / Service Discount Teasers | No | Yes | No | No |
| View Team Reward Area | Yes | Yes | No | No |
| In-House Rewards Creation Center | Coming Soon | Coming Soon | No | No |
| See Rewards Offered by Own Business/Home | As manager/source | As manager/source | Yes | Yes |
| See Other Team Members' Rewards | Visual / Coming Soon | Visual / Coming Soon | No | No |

---

# Supplier Rule

Suppliers do **not** receive this Reward Center architecture by default.

Supplier participation in advertising, sponsored products, offers, or brand campaigns belongs to the advertising/offer side of Roundhouse rather than the personal contribution reward system.

---

# MVP Boundary

The Reward Center must look exciting enough for testers to understand the future ecosystem, but implementation stays deliberately lean.

## MVP Functions

- Points can increase from a curated set of useful actions.
- User receives brief recognition when Points are earned.
- Point total updates.
- Progress bar updates.
- Status changes when a configured threshold is reached.
- A small set of badges may be earnable.
- Personal recent-point/activity accounting can be shown.

## Visual / Coming Soon

- Monetary-value rewards
- Sponsored-product fulfillment
- Tool giveaways
- Service-discount redemption
- Advertising benefits
- Brand-deal fulfillment
- Full strengths/performance reporting
- Team reward accounting
- In-House Rewards Creation Center
- reward redemption marketplace

**MVP Points represent recognition and progress. Future reward cards demonstrate potential benefits; they do not promise guaranteed monetary value.**

This boundary is intentional. Once Points can reliably convert into prizes or benefits with monetary value, Roundhouse will need additional eligibility, anti-abuse, fraud, fulfillment, redemption, and legal/business rules. Those systems should not bog down the MVP.

---

# Governing Reward Center Rule

**Roundhouse Points measure recognized participation. Points elevate Status. The Reward Center makes that progression visible now and shows what that participation may unlock later. Owners and Managers additionally see the future team-reward system; Team Members see only their own reward experience and rewards offered to them by Roundhouse or their governing Business/Home context.**
