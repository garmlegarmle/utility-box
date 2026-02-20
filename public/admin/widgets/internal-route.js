(function registerInternalRouteWidget() {
  if (!window.CMS || !window.React) return;

  const CMS = window.CMS;
  const React = window.React;

  class InternalRouteControl extends React.Component {
    constructor(props) {
      super(props);
      this.state = {
        options: [],
        loading: true,
        error: ''
      };
      this.onChange = this.onChange.bind(this);
      this.loadOptions = this.loadOptions.bind(this);
    }

    componentDidMount() {
      this.loadOptions();
    }

    componentDidUpdate(prevProps) {
      const prevLang = this.getLang(prevProps);
      const nextLang = this.getLang(this.props);
      if (prevLang !== nextLang) {
        this.loadOptions();
      }
    }

    getLang(props) {
      const langField = props.field?.get?.('langField') || 'lang';
      return props.entry?.getIn?.(['data', langField]) || props.field?.get?.('defaultLang') || 'en';
    }

    async loadOptions() {
      const lang = this.getLang(this.props);
      const source = `/internal-routes.${lang}.json`;

      this.setState({ loading: true, error: '' });

      try {
        const res = await fetch(source, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`Failed to load ${source}`);
        }

        const data = await res.json();
        const options = Array.isArray(data) ? data : [];
        this.setState({ options, loading: false, error: '' });
      } catch (error) {
        this.setState({ options: [], loading: false, error: error?.message || 'Failed to load routes' });
      }
    }

    onChange(event) {
      this.props.onChange(event.target.value);
    }

    render() {
      const { forID, value, classNameWrapper, setActiveStyle, setInactiveStyle } = this.props;
      const { options, loading, error } = this.state;

      return React.createElement(
        'div',
        { className: classNameWrapper },
        React.createElement(
          'select',
          {
            id: forID,
            value: value || '',
            onFocus: setActiveStyle,
            onBlur: setInactiveStyle,
            onChange: this.onChange,
            style: { width: '100%' }
          },
          React.createElement('option', { value: '' }, loading ? 'Loading routes...' : 'Select internal route'),
          options.map((option) =>
            React.createElement(
              'option',
              { key: option.href, value: option.href },
              `${option.label} (${option.href})`
            )
          )
        ),
        error ? React.createElement('p', { style: { color: '#b00020', marginTop: '0.5rem' } }, error) : null,
        React.createElement('p', { style: { color: '#666', marginTop: '0.5rem' } }, 'If route list is empty, run the route index generator.')
      );
    }
  }

  const InternalRoutePreview = (props) => React.createElement('code', null, props.value || '');

  CMS.registerWidget('internalRoute', InternalRouteControl, InternalRoutePreview);
})();
