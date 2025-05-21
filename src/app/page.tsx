import { PaymentDisplay } from '@/components/payment-display';
import type { NextPage } from 'next';
import { Mountain } from 'lucide-react';

interface HomePageProps {
  searchParams: {
    ticketId?: string;
    amount?: string;
    phone?: string;
    email?: string;
  };
}

const HomePage: NextPage<HomePageProps> = ({ searchParams }) => {
  const { ticketId, amount, phone, email } = searchParams;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 sm:p-6 md:p-8">
      <header className="mb-8 text-center">
        <div className="flex items-center justify-center space-x-3 mb-2">
           {/* Using a simple SVG for RNR logo as no specific icon available */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-12 h-12 text-primary"
            aria-label="RNR Pay Logo"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
             <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fontSize="10" fill="hsl(var(--primary-foreground))">RNR</text>
          </svg>
          <h1 className="text-5xl font-extrabold tracking-tight text-foreground">
            RNR <span className="text-primary">Pay</span>
          </h1>
        </div>
        <p className="text-xl text-muted-foreground">
          Simple. Secure. Swift.
        </p>
      </header>
      
      <main className="w-full flex justify-center">
        <PaymentDisplay
          ticketId={ticketId}
          amount={amount}
          phone={phone}
          email={email}
        />
      </main>

      <footer className="mt-12 text-center text-muted-foreground text-sm">
        <p>&copy; {new Date().getFullYear()} RNR Solutions. All rights reserved.</p>
        <p>Secure Payment Processing</p>
      </footer>
    </div>
  );
};

export default HomePage;
