
import { PaymentDisplay } from '@/components/payment-display';
// Mountain icon is not used, removed to clean up.
// import { Mountain } from 'lucide-react'; 

interface HomePageProps {
  searchParams: {
    ticketId?: string;
    amount?: string;
    phone?: string;
    email?: string;
  };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const { ticketId, amount, phone, email } = searchParams;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 sm:p-6 md:p-8 antialiased">
      <header className="mb-6 sm:mb-8 text-center">
        <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-3 mb-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 100 100" // Adjusted viewBox for better text fitting potentially
            className="w-12 h-12 sm:w-14 sm:h-14 text-primary"
            aria-label="RNR Pay Logo"
            fill="currentColor"
          >
            {/* Simplified RNR logo design */}
            <path d="M50 5C25.15 5 5 25.15 5 50s20.15 45 45 45 45-20.15 45-45S74.85 5 50 5zm0 82C29.07 87 13 70.93 13 50S29.07 13 50 13s37 16.07 37 37-16.07 37-37 37z" />
            <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle" fontSize="30" fontWeight="bold" fill="hsl(var(--primary-foreground))">
              RNR
            </text>
          </svg>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
            RNR <span className="text-primary">Pay</span>
          </h1>
        </div>
        <p className="text-lg sm:text-xl text-muted-foreground">
          Simple. Secure. Swift.
        </p>
      </header>
      
      <main className="w-full flex justify-center px-2">
        <PaymentDisplay
          ticketId={ticketId}
          amount={amount}
          phone={phone}
          email={email}
        />
      </main>

      <footer className="mt-10 sm:mt-12 text-center text-muted-foreground text-xs sm:text-sm">
        <p>&copy; {new Date().getFullYear()} RNR Solutions. All rights reserved.</p>
        <p>Secure M-Pesa Payment Processing</p>
      </footer>
    </div>
  );
}
