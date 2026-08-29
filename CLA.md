# Wallgraph Individual Contributor License Agreement

**Version 1.0**

Thank you for your interest in contributing to Wallgraph ("the Project"), owned and
maintained by Jeffrey Ernst ("the Maintainer").

This agreement clarifies the intellectual-property licence granted with Contributions from
any person or entity. It protects You as a Contributor as well as the Maintainer and the
Project's users; it does **not** change your right to use your own Contribution for any
other purpose.

Wallgraph is released publicly under the GNU AGPL v3, and the Maintainer additionally
offers it under separate commercial terms to parties for whom the AGPL is unsuitable.
Section 2 is what makes that dual-licensing possible: without it, a single Contribution
from a third party would make it impossible for the Maintainer to grant a commercial
licence covering the whole work.

You accept and agree to the following terms for Your present and future Contributions
submitted to the Project. Except for the licences granted here, You retain all right,
title and interest in and to Your Contributions.

## 1. Definitions

**"You"** (or **"Your"**) means the copyright owner, or the legal entity authorised by the
copyright owner, that is entering into this Agreement with the Maintainer.

**"Contribution"** means any original work of authorship, including any modification of or
addition to an existing work, that is intentionally submitted by You to the Maintainer for
inclusion in, or documentation of, the Project. "Submitted" means any form of electronic,
verbal or written communication sent to the Maintainer or its representatives, including
but not limited to communication on electronic mailing lists, source-code control systems
and issue-tracking systems that are managed by, or on behalf of, the Maintainer for the
purpose of discussing and improving the Project — excluding communication that is
conspicuously marked or otherwise designated in writing by You as "Not a Contribution".

## 2. Grant of Copyright Licence and Right to Relicense

Subject to the terms and conditions of this Agreement, You grant to the Maintainer a
perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright licence
to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense
and distribute Your Contributions and such derivative works.

You further grant the Maintainer the right to license Your Contributions, and derivative
works thereof, **under any licence terms the Maintainer chooses, including without
limitation the GNU AGPL v3, any other open-source licence, and proprietary or commercial
licence terms**, with or without a requirement to disclose source code, and to charge a fee
for doing so. You waive no rights of Your own by this grant: You may continue to use,
license and exploit Your Contributions however You wish.

This grant is non-exclusive and does not transfer ownership. You remain the copyright
owner of Your Contributions.

## 3. Grant of Patent Licence

Subject to the terms and conditions of this Agreement, You grant to the Maintainer and to
recipients of software distributed by the Maintainer a perpetual, worldwide, non-exclusive,
no-charge, royalty-free, irrevocable (except as stated in this section) patent licence to
make, have made, use, offer to sell, sell, import and otherwise transfer the Project, where
such licence applies only to those patent claims licensable by You that are necessarily
infringed by Your Contribution alone or by combination of Your Contribution with the
Project to which it was submitted.

If any entity institutes patent litigation against You or any other entity — including a
cross-claim or counterclaim in a lawsuit — alleging that Your Contribution, or the Project
to which You contributed, constitutes direct or contributory patent infringement, then any
patent licences granted to that entity under this Agreement for that Contribution or
Project terminate as of the date such litigation is filed.

## 4. Your Representations

You represent that:

a. You are legally entitled to grant the above licences.

b. Each of Your Contributions is Your original creation, or You have sufficient rights in
   it to grant the licences in Sections 2 and 3.

c. **If Your employer has rights to intellectual property that You create**, including
   anything You create using an employer's equipment or during working hours, You represent
   that You have received permission to make the Contributions on behalf of that employer,
   that Your employer has waived such rights for Your Contributions, or that Your employer
   has executed the Wallgraph Corporate Contributor Licence Agreement
   ([CLA-CORPORATE.md](CLA-CORPORATE.md)).

d. Your Contribution does not include third-party material that is subject to a licence
   incompatible with Section 2 — in particular, material You cannot permit the Maintainer
   to relicense under proprietary terms. If Your Contribution includes any third-party
   material, You will identify it, together with its source and licence, in Your submission
   and in the Contribution itself.

## 5. No Obligation

You are not expected to provide support for Your Contributions, except to the extent You
desire to do so. Unless required by applicable law or agreed to in writing, You provide
Your Contributions on an **"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND**,
either express or implied, including without limitation any warranties of TITLE,
NON-INFRINGEMENT, MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

The Maintainer is under no obligation to accept, merge or use any Contribution.

## 6. Notice of Change

You agree to notify the Maintainer of any facts or circumstances of which You become aware
that would make the representations in this Agreement inaccurate in any respect.

## 7. Governing Law

This Agreement is governed by the laws of the Netherlands, without regard to its
conflict-of-law provisions.

---

## How to sign

Signing is a one-time step that covers all of your future contributions.

1. Open a pull request that adds your GitHub username to
   [`.github/cla-signatures.json`](.github/cla-signatures.json), with today's date:

   ```json
   { "username": "your-github-username", "name": "Your Full Name", "date": "2026-01-31" }
   ```

2. Title the pull request `CLA: sign for @your-github-username`, and in the description
   include this sentence:

   > I have read the Wallgraph Individual Contributor License Agreement and I hereby agree
   > to its terms for all of my present and future Contributions to the Project.

3. Once the Maintainer merges it, the CLA check will pass on all of your pull requests.

The merged commit — authored by your GitHub account, carrying your explicit statement of
agreement — is the record of your signature.

If you are contributing on behalf of a company, your employer should also execute the
[Corporate CLA](CLA-CORPORATE.md).
