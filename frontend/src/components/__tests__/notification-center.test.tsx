import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationCenter } from '../notification-center'

describe('NotificationCenter', () => {
  const mockNotifications = [
    {
      id: '1',
      type: 'info' as const,
      title: 'Test Notification',
      message: 'This is a test notification',
      timestamp: new Date(),
      read: false,
    },
  ]

  it('renders notification bell icon', () => {
    render(<NotificationCenter notifications={[]} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('shows unread count badge', () => {
    render(<NotificationCenter notifications={mockNotifications} />)
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('opens dropdown when bell is clicked', () => {
    render(<NotificationCenter notifications={mockNotifications} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByText('Test Notification')).toBeInTheDocument()
  })

  it('marks notification as read when clicked', () => {
    const onMarkAsRead = jest.fn()
    render(
      <NotificationCenter
        notifications={mockNotifications}
        onMarkAsRead={onMarkAsRead}
      />
    )
    const button = screen.getByRole('button')
    fireEvent.click(button)
    fireEvent.click(screen.getByText('Test Notification'))
    expect(onMarkAsRead).toHaveBeenCalledWith('1')
  })
})
