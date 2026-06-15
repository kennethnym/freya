import { Link } from "react-router"
import { Streamdown } from "streamdown"

import { AnimatedLogo, AnimatedLogoState } from "~/components/animated-logo"

import type { Route } from "./+types/privacy-policy"

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Privacy Policy — Freya" },
		{ name: "description", content: "Freya privacy policy" },
	]
}

export default function PrivacyPolicy() {
	return (
		<main className="relative max-w-2xl mx-auto px-6 py-16">
			<Link to="/" className="block w-fit mb-8">
				<AnimatedLogo className="size-10 pointer-events-none" state={AnimatedLogoState.Idle} />
			</Link>
			<Streamdown
				isAnimating={false}
				linkSafety={{ enabled: false }}
				components={{
					a: ({ className, ...props }) => <a className={`underline ${className}`} {...props} />,
				}}
			>
				{POLICY}
			</Streamdown>
			<footer className="mt-16 pt-8 border-t border-stone-200 dark:border-stone-700">
				<Link to="/" className="text-sm opacity-50 hover:opacity-75 underline">
					Back to home
				</Link>
			</footer>
		</main>
	)
}

const POLICY = `# Privacy Policy

**Last updated:** March 5, 2026

This Privacy Policy describes how **Freya** ("we", "us", or "our") collects, uses, and protects your personal information when you visit **https://freya.chat** or interact with our services.

If you do not agree with this Privacy Policy, please do not use the website.

For any questions, contact: **[kenneth@nym.sh](mailto:kenneth@nym.sh)**

---

## 1. Information We Collect

### Personal Information You Provide

**In Short:** We collect personal information that you provide to us.

We collect personal information that you voluntarily provide when you express interest in our services, contact us, or sign up for the waitlist.

We collect your email address when you sign up for the waitlist so we can notify you when the product launches or provide related updates.

### Personal Information Provided by You

The personal information we collect may include:

* email addresses

You are responsible for ensuring the personal information you provide is accurate and up to date.

### Sensitive Information

We **do not collect or process sensitive personal information**.

### Information From Third Parties

We **do not collect personal information from third parties**.

---

## 2. How We Use Your Information

We process your information for the following purposes:

* To operate and maintain our services
* To communicate with you about product updates and launch announcements
* To send administrative information such as policy updates
* To prevent fraud or abuse
* To comply with legal obligations
* To protect someone’s safety when necessary

We only process personal information when we have a valid legal reason to do so.

---

## 3. Legal Bases for Processing (EU / UK)

If you are located in the European Economic Area (EEA) or the United Kingdom, we rely on the following legal bases to process personal information:

### Consent

You have given permission for us to process your personal information for a specific purpose.

### Contract

Processing is necessary to provide services you requested.

### Legal Obligations

Processing is required to comply with applicable laws.

### Vital Interests

Processing is necessary to protect someone's safety.

You may withdraw consent at any time by contacting us.

---

## 4. When and With Whom We Share Personal Information

We may share your personal information in limited situations.

### Service Providers

We may share information with trusted service providers that help us operate our website or manage communications.

### Business Transfers

We may transfer information during negotiations of a merger, sale of assets, financing, or acquisition of our business.

We **do not sell your personal information**.

---

## 5. How Long We Keep Your Information

We retain personal information only as long as necessary to:

* provide services
* comply with legal obligations
* resolve disputes
* enforce agreements

When we no longer need personal information, we delete or anonymize it where possible.

---

## 6. How We Keep Your Information Safe

We implement reasonable technical and organizational safeguards designed to protect personal information.

However, no electronic transmission or storage system is completely secure. We cannot guarantee absolute security.

---

## 7. Information From Minors

Our services are **not intended for individuals under 18 years old**.

We do not knowingly collect personal information from children. If we discover that we have collected such information, we will delete it.

If you believe a child has provided personal information, contact **[kenneth@nym.sh](mailto:kenneth@nym.sh)**.

---

## 8. Your Privacy Rights

Depending on your location, you may have rights regarding your personal information, including:

* the right to access your data
* the right to correct inaccurate data
* the right to delete your data
* the right to restrict processing
* the right to data portability
* the right to object to processing
* the right to withdraw consent

To exercise these rights, submit a request:

https://app.termly.io/dsar/b8633d03-406f-4133-b16e-ded63e893997

Or contact us at **[kenneth@nym.sh](mailto:kenneth@nym.sh)**.

---

## 9. Do Not Track (DNT)

Many browsers include a **Do Not Track (DNT)** feature.

Because there is currently no consistent standard for responding to DNT signals, we do not respond to them.

---

## 10. Global Privacy Control

We recognize **Global Privacy Control (GPC)** signals.

If your browser sends a GPC signal, we treat it as a request to opt out of the sale or sharing of personal information where applicable.

More information: https://globalprivacycontrol.org

---

## 11. Privacy Rights in Other Regions

Additional privacy rights may apply depending on your location, including:

* European Economic Area (EEA)
* United Kingdom
* Switzerland
* Canada
* United States
* Australia
* New Zealand

If you believe we are processing your personal information unlawfully, you may contact your local data protection authority.

---

## 12. Updates to This Privacy Policy

We may update this Privacy Policy from time to time.

When we do, we will update the **Last updated** date at the top of this document.

We encourage users to review this Privacy Policy regularly.

---

## 13. Contact Information

If you have questions or comments about this Privacy Policy, you may contact us:

**Freya**

Email: **[kenneth@nym.sh](mailto:kenneth@nym.sh)**

---

## 14. Request Access, Update, or Deletion

Depending on applicable law, you may request access to, correction of, or deletion of your personal information.

Email:

**[kenneth@nym.sh](mailto:kenneth@nym.sh)**
`
