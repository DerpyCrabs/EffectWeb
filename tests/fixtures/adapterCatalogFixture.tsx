import './shadcn.css';
import { mount, view } from 'effectweb';
import {
  Chart,
  CodeBlockContent,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireInput,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireSubmit,
  QuestionnaireProgress,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerButton,
} from '../../packages/shadcn/src/index';
import Heart from '@effectweb/antd-icons/icons/HeartTwoTone';
export function mountCatalog(host: HTMLElement) {
  const App = view(() => (
    <div>
      <Questionnaire
        onComplete={(answers) => {
          const city = answers.get('city');
          host.dataset.answer = typeof city === 'string' ? city : '';
        }}
      >
        <QuestionnaireProgress />
        <QuestionnaireItem>
          <QuestionnaireInput required name="city" aria-label="City" />
        </QuestionnaireItem>
        <QuestionnaireItem>Review</QuestionnaireItem>
        <QuestionnairePrevious />
        <QuestionnaireNext />
        <QuestionnaireSubmit />
      </Questionnaire>
      <InputGroup>
        <InputGroupAddon>Search</InputGroupAddon>
        <InputGroupInput aria-label="Search field" />
      </InputGroup>
      <CodeBlockContent lineNumbers>{'one\ntwo'}</CodeBlockContent>
      <Heart title="Favorite" twoToneColor={['red', 'blue']} />
      <Chart
        label="Sales"
        data={[{ id: 'q', label: 'Q1', values: { sold: 3 } }]}
        config={{ sold: { label: 'Sold', color: 'red' } }}
      />
      <MessageScroller>
        <MessageScrollerViewport style={{ height: '40px' }}>
          <MessageScrollerContent style={{ height: '200px' }}>Messages</MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="start" />
        <MessageScrollerButton direction="end" />
      </MessageScroller>
    </div>
  ));
  return mount(host, App, {});
}
